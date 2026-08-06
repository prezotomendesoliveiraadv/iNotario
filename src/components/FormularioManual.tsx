import { useState } from 'react'

export interface DadosManuais {
  solicitante: { nome: string; cpf: string; telefone: string; email: string }
  partes: { papel: string; nome: string; cpf: string; rg: string; estado_civil: string }[]
  objeto: { descricao: string; matricula: string; cartorio_ri: string; endereco: string; valor: string }
  contrato: string
  observacoes: string
}

const vazio = (): DadosManuais => ({
  solicitante: { nome: '', cpf: '', telefone: '', email: '' },
  partes: [
    { papel: 'Vendedor', nome: '', cpf: '', rg: '', estado_civil: '' },
    { papel: 'Comprador', nome: '', cpf: '', rg: '', estado_civil: '' },
  ],
  objeto: { descricao: '', matricula: '', cartorio_ri: '', endereco: '', valor: '' },
  contrato: '', observacoes: '',
})

const ESTADOS = ['', 'solteiro(a)', 'casado(a)', 'divorciado(a)', 'viúvo(a)', 'união estável']

/**
 * Preenchimento manual — para quem prefere digitar a conversar.
 * Mesmos campos que a Artemis coletaria, na ordem em que o cartório precisa.
 * A pessoa pode voltar para a conversa a qualquer momento.
 */
export default function FormularioManual({
  inicial, onEnviar, onVoltarConversa, enviando,
}: {
  inicial?: Partial<DadosManuais>
  onEnviar: (d: DadosManuais) => void
  onVoltarConversa: () => void
  enviando?: boolean
}) {
  const [d, setD] = useState<DadosManuais>({ ...vazio(), ...(inicial as DadosManuais) })
  const [erro, setErro] = useState<string | null>(null)

  const setSol = (k: string, v: string) => setD(x => ({ ...x, solicitante: { ...x.solicitante, [k]: v } }))
  const setObj = (k: string, v: string) => setD(x => ({ ...x, objeto: { ...x.objeto, [k]: v } }))
  const setParte = (i: number, k: string, v: string) =>
    setD(x => ({ ...x, partes: x.partes.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }))

  return (
    <div className="card" style={{ padding: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Preenchimento manual</div>
          <h2 className="font-serif" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--navy)' }}>
            Informe os dados
          </h2>
          <p className="muted" style={{ fontSize: '.78rem' }}>
            Preencha o que souber — o que faltar o cartório completa depois. Campos com * são necessários.
          </p>
        </div>
        <button className="btn-ghost" onClick={onVoltarConversa}>← prefiro conversar</button>
      </div>

      {/* solicitante */}
      <div style={{ marginTop: '.9rem' }}>
        <div className="eyebrow" style={{ marginBottom: '.3rem' }}>Seus dados</div>
        <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <label style={{ fontSize: '.72rem' }}>Nome completo *
            <input className="input" value={d.solicitante.nome} onChange={e => setSol('nome', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>CPF
            <input className="input" value={d.solicitante.cpf} onChange={e => setSol('cpf', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>WhatsApp *
            <input className="input" placeholder="(11) 99999-9999" value={d.solicitante.telefone}
              onChange={e => setSol('telefone', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>E-mail
            <input className="input" type="email" value={d.solicitante.email} onChange={e => setSol('email', e.target.value)} /></label>
        </div>
      </div>

      {/* partes */}
      <div style={{ marginTop: '.9rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="eyebrow">Partes do ato</div>
          <button className="btn-ghost" style={{ padding: '.15rem .6rem', fontSize: '.75rem' }}
            onClick={() => setD(x => ({ ...x, partes: [...x.partes, { papel: '', nome: '', cpf: '', rg: '', estado_civil: '' }] }))}>
            + adicionar pessoa
          </button>
        </div>
        {d.partes.map((p, i) => (
          <div key={i} style={{ display: 'grid', gap: '.4rem', marginTop: '.4rem',
                                gridTemplateColumns: 'minmax(110px,.8fr) minmax(150px,1.4fr) minmax(110px,.9fr) minmax(100px,.8fr) minmax(120px,1fr) auto' }}>
            <input className="input" placeholder="Papel" value={p.papel} onChange={e => setParte(i, 'papel', e.target.value)} />
            <input className="input" placeholder="Nome completo" value={p.nome} onChange={e => setParte(i, 'nome', e.target.value)} />
            <input className="input" placeholder="CPF/CNPJ" value={p.cpf} onChange={e => setParte(i, 'cpf', e.target.value)} />
            <input className="input" placeholder="RG" value={p.rg} onChange={e => setParte(i, 'rg', e.target.value)} />
            <select className="input" value={p.estado_civil} onChange={e => setParte(i, 'estado_civil', e.target.value)}>
              {ESTADOS.map(x => <option key={x} value={x}>{x || 'estado civil'}</option>)}
            </select>
            <button className="btn-ghost" style={{ padding: '.15rem .5rem' }} title="Remover"
              onClick={() => setD(x => ({ ...x, partes: x.partes.filter((_, idx) => idx !== i) }))}>×</button>
          </div>
        ))}
      </div>

      {/* objeto */}
      <div style={{ marginTop: '.9rem' }}>
        <div className="eyebrow" style={{ marginBottom: '.3rem' }}>Objeto do negócio</div>
        <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <label style={{ fontSize: '.72rem', gridColumn: '1 / -1' }}>Descrição do bem ou finalidade *
            <input className="input" placeholder="ex.: apartamento 302, Residencial Aurora"
              value={d.objeto.descricao} onChange={e => setObj('descricao', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>Nº da matrícula
            <input className="input" value={d.objeto.matricula} onChange={e => setObj('matricula', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>Cartório de registro
            <input className="input" value={d.objeto.cartorio_ri} onChange={e => setObj('cartorio_ri', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>Endereço do imóvel
            <input className="input" value={d.objeto.endereco} onChange={e => setObj('endereco', e.target.value)} /></label>
          <label style={{ fontSize: '.72rem' }}>Valor
            <input className="input" placeholder="R$" value={d.objeto.valor} onChange={e => setObj('valor', e.target.value)} /></label>
        </div>
      </div>

      {/* contrato e observações */}
      <div style={{ marginTop: '.9rem', display: 'grid', gap: '.5rem' }}>
        <label style={{ fontSize: '.72rem' }}>Contrato / compromisso (dados principais)
          <textarea className="input" style={{ minHeight: 56 }} placeholder="Data, forma de pagamento, condições combinadas…"
            value={d.contrato} onChange={e => setD(x => ({ ...x, contrato: e.target.value }))} /></label>
        <label style={{ fontSize: '.72rem' }}>Observações
          <textarea className="input" style={{ minHeight: 46 }}
            value={d.observacoes} onChange={e => setD(x => ({ ...x, observacoes: e.target.value }))} /></label>
      </div>

      {erro && <div style={{ color: '#B3261E', fontSize: '.82rem', marginTop: '.5rem' }}>{erro}</div>}

      <p className="muted" style={{ fontSize: '.74rem', marginTop: '.7rem' }}>
        Depois de enviar, anexe os documentos (RG/CNH, matrícula e contrato) pelos botões da tela.
      </p>

      <button className="btn-primary" style={{ marginTop: '.6rem' }} disabled={enviando}
        onClick={() => {
          if (!d.solicitante.nome.trim() || !d.solicitante.telefone.trim()) {
            setErro('Informe ao menos seu nome e WhatsApp.'); return
          }
          if (!d.objeto.descricao.trim()) { setErro('Descreva o bem ou a finalidade do ato.'); return }
          setErro(null); onEnviar(d)
        }}>
        {enviando ? 'Enviando…' : 'Enviar dados'}
      </button>
    </div>
  )
}
