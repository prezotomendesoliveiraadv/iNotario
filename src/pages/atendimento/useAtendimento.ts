import { useEffect, useRef, useState } from 'react'
import { type ChatMsg } from '../../lib/artemis'
import {
  atenderTipos, atenderIniciar, atenderChat, atenderUpload, atenderFinalizar, atenderTraduzir, escutarComVAD,
  type ServicoLite, type Contato, type FichaIntake, type EscutaVAD,
} from '../../lib/atendimento'
import { TocadorPCM, conversarPorVoz } from '../../lib/voz'
import type { DadosManuais } from '../../components/FormularioManual'

/**
 * Toda a máquina de estado do atendimento público (/atender): conversa por
 * texto, voz mãos-livres com VAD, upload de documentos e finalização.
 *
 * As telas são puramente visuais e recebem este objeto — assim a regra de
 * atendimento tem um único lugar para ser lida, testada e corrigida.
 */
export function useAtendimento() {
  const [step, setStep] = useState<'escolha' | 'conversa' | 'ok'>('escolha')
  const [tipos, setTipos] = useState<ServicoLite[]>([])
  const [tipoSlug, setTipoSlug] = useState('')
  const [tipoNome, setTipoNome] = useState('')
  const [modoInicial, setModoInicial] = useState<'TEXTO' | 'VOZ'>('VOZ')
  // Trilha rápida (documentos primeiro) x conversa guiada
  const [trilha, setTrilha] = useState<'conversa' | 'documentos'>('conversa')
  const [alertaUnidade, setAlertaUnidade] = useState<any>(null)
  const [emprConfirmado, setEmprConfirmado] = useState<string | null>(null)
  const [contatoConfirmado, setContatoConfirmado] = useState(false)
  const [modoManual, setModoManual] = useState(false)
  const contatoRef = useRef<any>({})
  const [token, setToken] = useState('')
  const [protocolo, setProtocolo] = useState('')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [texto, setTexto] = useState('')
  const [canal, setCanal] = useState<'TEXTO' | 'VOZ'>('VOZ')
  const [vozAtiva, setVozAtiva] = useState(false)
  const [vozEstado, setVozEstado] = useState<'ouvindo' | 'pensando' | 'falando' | 'parado'>('parado')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [contato, setContato] = useState<Contato>({})
  const [lgpd, setLgpd] = useState(false)
  const [docs, setDocs] = useState<string[]>([])
  const [enviandoDoc, setEnviandoDoc] = useState(false)
  const [tipoDoc, setTipoDoc] = useState('rg')
  const [resumoFinal, setResumoFinal] = useState('')
  const [ficha, setFicha] = useState<FichaIntake | null>(null)
  // legenda
  const [legenda, setLegenda] = useState('')            // fala atual da Artemis (pt)
  const [legendaEn, setLegendaEn] = useState('')        // tradução (en)
  const [idioma, setIdioma] = useState<'pt' | 'en'>('pt')
  const idiomaRef = useRef<'pt' | 'en'>('pt')

  const vadRef = useRef<EscutaVAD | null>(null)
  const tocadorRef = useRef<TocadorPCM | null>(null)
  const falhasRef = useRef(0)
  const campoRef = useRef<HTMLTextAreaElement | null>(null)
  const loadingRef = useRef(false)
  const [sugerirTexto, setSugerirTexto] = useState(false)
  const msgsRef = useRef<ChatMsg[]>([])
  const tokenRef = useRef('')
  const ocupadoRef = useRef(false)
  const fimRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { atenderTipos().then(setTipos).catch(e => setErro(e.message)) }, [])
  useEffect(() => { msgsRef.current = msgs }, [msgs])
  useEffect(() => { idiomaRef.current = idioma }, [idioma])
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [msgs, loading, vozEstado])

  // O campo permanece habilitado enquanto a Artemis responde (é possível já ir
  // digitando). Ao terminar, o foco volta sozinho — desabilitar o campo faria o
  // navegador descartar o foco e obrigaria o cliente a clicar de novo a cada turno.
  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { contatoRef.current = contato }, [contato])

  // A Artemis preenche os campos da tela; a confirmação continua sendo do cliente.
  function aplicarCampos(c: any) {
    if (!c) return
    setContato(prev => ({
      ...prev,
      nome: c.nome ?? prev.nome,
      whatsapp: c.telefone ?? prev.whatsapp,
      email: c.email ?? prev.email,
    }))
    if (c.nome || c.telefone) setContatoConfirmado(false)
  }
  useEffect(() => {
    if (canal === 'TEXTO' && !loading && step === 'conversa') campoRef.current?.focus()
  }, [loading, canal, step])
  useEffect(() => () => { vadRef.current?.stop(); tocadorRef.current?.fechar() }, [])

  // Define a legenda (pt) e, se o idioma for inglês, busca a tradução em paralelo
  async function definirLegenda(txt: string) {
    setLegenda(txt); setLegendaEn('')
    if (idiomaRef.current === 'en' && txt) {
      try { const t = await atenderTraduzir(tokenRef.current, txt); setLegendaEn(t.texto) } catch { /* legenda é best-effort */ }
    }
  }

  async function iniciar() {
    if (!tipoSlug) { setErro('Escolha o serviço desejado.'); return }
    setErro(null); setLoading(true)
    try {
      const querVoz = modoInicial === 'VOZ'
      // destrava o áudio no gesto do usuário (exigência dos navegadores)
      if (querVoz && !tocadorRef.current) {
        tocadorRef.current = new TocadorPCM()
        await tocadorRef.current.destravar()
      }
      const r = await atenderIniciar(tipoSlug, false)   // sem esperar TTS: o áudio vem em streaming
      setToken(r.token); tokenRef.current = r.token; setProtocolo(r.protocolo); setTipoNome(r.tipoAtoNome)
      const saudacao = r.saudacao
      setMsgs([{ role: 'assistant', content: saudacao }])
      setCanal(modoInicial)
      setStep('conversa')
      setLoading(false)
      void definirLegenda(saudacao)

      if (querVoz) {
        setVozEstado('falando')
        const t = tocadorRef.current!
        await conversarPorVoz(
          { token: r.token, messages: [], tipoAtoNome: r.tipoAtoNome, texto: saudacao },
          { onAudio: (pcm) => t.enfileirar(pcm), onErro: (m) => setErro(m) },
        )
        await t.aguardarFim()
        await ligarVoz()
      }
    } catch (e: any) { setErro(e.message ?? 'Falha ao iniciar.'); setLoading(false) }
  }

  // ---------- texto ----------
  async function enviarTexto(conteudo: string) {
    const t = conteudo.trim(); if (!t) return
    if (loadingRef.current) return   // já há um turno em andamento
    setErro(null); setLoading(true)
    const base = [...msgsRef.current, { role: 'user', content: t } as ChatMsg]
    setMsgs(base); setTexto('')
    try {
      const r = await atenderChat({ token, channel: 'TEXTO', messages: base, tipoAtoNome: tipoNome, trilha,
        campos: { nome: contatoRef.current.nome, telefone: contatoRef.current.whatsapp, email: contatoRef.current.email } })
      aplicarCampos((r as any).campos)
      if ((r as any).empreendimento_confirmado) setEmprConfirmado((r as any).empreendimento_confirmado)
      if ((r as any).alerta_unidade) setAlertaUnidade((r as any).alerta_unidade)
      setMsgs([...base, { role: 'assistant', content: r.reply }])
      await definirLegenda(r.reply)
    } catch (e: any) { setErro(e.message ?? 'Falha na conversa.') } finally { setLoading(false) }
  }

  // ---------- voz mãos-livres ----------
  async function ligarVoz() {
    setErro(null)
    if (vadRef.current) { vadRef.current.resume(); setVozAtiva(true); setVozEstado('ouvindo'); return }
    try {
      const vad = await escutarComVAD(async (audio) => {
        if (ocupadoRef.current) return
        ocupadoRef.current = true
        vadRef.current?.pause(); setVozEstado('pensando')
        try {
          if (!tocadorRef.current) { tocadorRef.current = new TocadorPCM(); await tocadorRef.current.destravar() }
          const tocador = tocadorRef.current
          const base = msgsRef.current
          let primeiroAudio = true

          await conversarPorVoz(
            { token: tokenRef.current, messages: base, tipoAtoNome: tipoNome, audio, trilha,
              campos: { nome: contatoRef.current.nome, telefone: contatoRef.current.whatsapp, email: contatoRef.current.email } },
            {
              onMeta: (m) => {
                if ((m as any).alerta_unidade) setAlertaUnidade((m as any).alerta_unidade)
                aplicarCampos((m as any).campos)
                // o texto aparece IMEDIATAMENTE, antes mesmo do áudio
                void definirLegenda(m.resposta)
                // Rede de segurança: duas falhas seguidas → oferece digitar.
                // Nome próprio é o caso mais difícil para qualquer transcrição.
                if (m.inaudivel) { falhasRef.current += 1; if (falhasRef.current >= 2) setSugerirTexto(true) }
                else { falhasRef.current = 0; setSugerirTexto(false) }
                if (!m.inaudivel && !m.saudacao) {
                  const next = [...base]
                  if (m.transcricao) next.push({ role: 'user', content: m.transcricao })
                  next.push({ role: 'assistant', content: m.resposta })
                  setMsgs(next)
                }
              },
              onAudio: (pcm) => {
                if (primeiroAudio) { setVozEstado('falando'); primeiroAudio = false }
                tocador.enfileirar(pcm)   // começa a tocar já no 1º pedaço
              },
              onErro: (m) => setErro(m),
            },
          )
          await tocador.aguardarFim()
        } catch (e: any) { setErro(e.message ?? 'Falha na conversa por voz.') }
        finally {
          ocupadoRef.current = false
          if (vadRef.current) { vadRef.current.resume(); setVozEstado('ouvindo') }
        }
      }, { silencioMs: 1200 })
      vadRef.current = vad
      vad.resume()
      setVozAtiva(true); setVozEstado('ouvindo')
    } catch { setErro('Não foi possível acessar o microfone. Verifique a permissão do navegador (e use HTTPS).') }
  }
  function desligarVoz() { vadRef.current?.pause(); setVozAtiva(false); setVozEstado('parado') }

  useEffect(() => { if (canal === 'TEXTO' && vozAtiva) desligarVoz() }, [canal])

  // ---------- documentos / finalizar ----------
  async function subirDoc(file: File | null) {
    if (!file) return
    setEnviandoDoc(true); setErro(null)
    try { await atenderUpload(token, file, tipoDoc); setDocs(d => [...d, `${tipoDoc.toUpperCase()} · ${file.name}`]) }
    catch (e: any) { setErro(e.message ?? 'Falha ao anexar.') } finally { setEnviandoDoc(false) }
  }

  async function finalizar() {
    if (!lgpd) { setErro('É necessário aceitar os termos da LGPD.'); return }
    if (!contato.nome || !contato.whatsapp) { setErro('Informe ao menos seu nome e WhatsApp para contato.'); return }
    setLoading(true); setErro(null)
    try {
      vadRef.current?.stop(); vadRef.current = null; setVozAtiva(false)
      const r = await atenderFinalizar(token, { messages: msgsRef.current, contato, lgpd_aceite: lgpd })
      setProtocolo(r.protocolo); setResumoFinal(r.resumo || ''); setFicha(r.ficha ?? null); setStep('ok')
    } catch (e: any) { setErro(e.message ?? 'Falha ao finalizar.') } finally { setLoading(false) }
  }

  // Tradução da legenda sob demanda (botão EN). Best-effort: falhar aqui não
  // pode interromper o atendimento.
  async function traduzirLegenda() {
    setIdioma('en')
    if (legenda && !legendaEn) {
      try { const t = await atenderTraduzir(tokenRef.current, legenda); setLegendaEn(t.texto) } catch { /* legenda é best-effort */ }
    }
  }

  // Formulário manual: os dados digitados entram na conversa como uma fala do
  // cliente, para que resumo, LGPD e protocolo sigam exatamente o mesmo fluxo.
  async function enviarFormularioManual(d: DadosManuais) {
    setLoading(true); setErro(null)
    try {
      setContato(c => ({ ...c, nome: d.solicitante.nome, whatsapp: d.solicitante.telefone, email: d.solicitante.email }))
      setContatoConfirmado(true)
      // Entrega os dados à Artemis como uma fala do cliente: o restante
      // do fluxo (resumo, LGPD, protocolo) segue exatamente igual.
      const resumo = [
        `Prefiro preencher manualmente. Seguem os dados:`,
        `Solicitante: ${d.solicitante.nome}${d.solicitante.cpf ? `, CPF ${d.solicitante.cpf}` : ''}, WhatsApp ${d.solicitante.telefone}${d.solicitante.email ? `, e-mail ${d.solicitante.email}` : ''}.`,
        `Partes: ${d.partes.filter(p => p.nome.trim()).map(p =>
          `${p.papel || 'parte'} ${p.nome}${p.cpf ? ` (CPF ${p.cpf})` : ''}${p.rg ? `, RG ${p.rg}` : ''}${p.estado_civil ? `, ${p.estado_civil}` : ''}`).join('; ') || 'não informadas'}.`,
        `Objeto: ${d.objeto.descricao}${d.objeto.matricula ? `, matrícula ${d.objeto.matricula}` : ''}${d.objeto.cartorio_ri ? ` (${d.objeto.cartorio_ri})` : ''}${d.objeto.endereco ? `, ${d.objeto.endereco}` : ''}${d.objeto.valor ? `, valor ${d.objeto.valor}` : ''}.`,
        d.contrato ? `Contrato: ${d.contrato}.` : '',
        d.observacoes ? `Observações: ${d.observacoes}.` : '',
      ].filter(Boolean).join('\n')
      setModoManual(false)
      await enviarTexto(resumo)
    } catch (e: any) { setErro(e.message ?? 'Falha ao enviar.') }
    finally { setLoading(false) }
  }

  const legendaExibida = idioma === 'en' ? (legendaEn || legenda) : legenda

  return {
    // navegação
    step,
    // escolha do serviço
    tipos, tipoSlug, setTipoSlug, tipoNome, modoInicial, setModoInicial,
    trilha, setTrilha, modoManual, setModoManual,
    // sessão
    protocolo, msgs, texto, setTexto, loading, erro,
    // canal e voz
    canal, setCanal, vozAtiva, vozEstado, sugerirTexto, setSugerirTexto, falhasRef,
    // legenda
    idioma, setIdioma, legendaExibida, traduzirLegenda,
    // dados do cliente
    contato, setContato, contatoConfirmado, setContatoConfirmado,
    emprConfirmado, alertaUnidade, lgpd, setLgpd,
    // documentos
    docs, tipoDoc, setTipoDoc, enviandoDoc,
    // resultado
    resumoFinal, ficha,
    // refs de DOM
    campoRef, fimRef,
    // ações
    iniciar, enviarTexto, enviarFormularioManual, ligarVoz, desligarVoz, subirDoc, finalizar,
  }
}

export type Atendimento = ReturnType<typeof useAtendimento>
