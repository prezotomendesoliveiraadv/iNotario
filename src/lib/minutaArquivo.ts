import { supabase } from './supabase'
import { sha256 } from './minutaEngine'

// ============================================================================
// Versões da minuta — baixar e subir
//
// O .docx é gerado como WordprocessingML plano (um XML dentro de um zip), sem
// biblioteca: o texto da minuta é linear, e trazer uma dependência de 300 KB
// para o navegador só para envolver parágrafos não se justifica.
//
// O PDF sai do próprio navegador (window.print numa janela isolada), o que
// preserva acentuação e quebra de página sem fonte embarcada.
// ============================================================================

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Cabeçalho de cláusula, para destacar em negrito no documento gerado. */
const CABECALHO = /^\s*(?:cl[áa]usula\s+)?\d{1,2}\s*[ªº.\-–—:)]/i

function paragrafosXml(texto: string): string {
  return texto.split('\n').map(linha => {
    const t = linha.trimEnd()
    if (!t) return '<w:p/>'
    const forte = CABECALHO.test(t) || /^[A-ZÀ-Ú\s\d.ªº—-]{8,}$/.test(t)
    return `<w:p><w:pPr><w:spacing w:after="120" w:line="300"/>${
      forte ? '<w:jc w:val="left"/>' : '<w:jc w:val="both"/>'
    }</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>${
      forte ? '<w:b/>' : ''
    }<w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`
  }).join('')
}

/** Zip mínimo sem compressão (STORED) — suficiente para um .docx válido. */
function zipSimples(arquivos: { nome: string; conteudo: string }[]): Blob {
  const enc = new TextEncoder()
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const crcTabela = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[i] = c >>> 0
    }
    return t
  })()
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff
    for (let i = 0; i < b.length; i++) c = crcTabela[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255])
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255])
  const junta = (arr: Uint8Array[]) => {
    const total = arr.reduce((a, b) => a + b.length, 0)
    const out = new Uint8Array(total)
    let p = 0
    for (const a of arr) { out.set(a, p); p += a.length }
    return out
  }

  for (const f of arquivos) {
    const nome = enc.encode(f.nome)
    const dados = enc.encode(f.conteudo)
    const crc = crc32(dados)
    const local = junta([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dados.length), u32(dados.length), u16(nome.length), u16(0), nome, dados,
    ])
    partes.push(local)
    central.push(junta([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(dados.length), u32(dados.length),
      u16(nome.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nome,
    ]))
    offset += local.length
  }

  const dirBytes = junta(central)
  const fim = junta([
    u32(0x06054b50), u16(0), u16(0), u16(arquivos.length), u16(arquivos.length),
    u32(dirBytes.length), u32(offset), u16(0),
  ])
  return new Blob([junta(partes), dirBytes, fim], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

export function minutaParaDocx(texto: string, titulo: string): Blob {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragrafosXml(texto)}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1701"/></w:sectPr>
</w:body></w:document>`

  return zipSimples([
    { nome: '[Content_Types].xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { nome: '_rels/.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { nome: 'word/document.xml', conteudo: doc },
  ])
}

export function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** PDF pela impressão do navegador — mantém acentuação sem fonte embarcada. */
export function minutaParaPdf(texto: string, titulo: string) {
  const w = window.open('', '_blank')
  if (!w) { alert('O navegador bloqueou a janela. Libere pop-ups para gerar o PDF.'); return }
  const corpo = texto.split('\n').map(l => {
    const t = l.trimEnd()
    if (!t) return '<p class="v"></p>'
    return CABECALHO.test(t) ? `<p class="c">${esc(t)}</p>` : `<p>${esc(t)}</p>`
  }).join('')
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: A4; margin: 2.5cm 2cm 2.5cm 3cm }
  body { font: 12pt/1.6 "Times New Roman", serif; color: #000 }
  p { text-align: justify; margin: 0 0 .5em }
  p.c { font-weight: bold; text-align: left; margin-top: 1em }
  p.v { margin: 0 0 .5em }
</style></head><body>${corpo}<script>window.onload=()=>{window.print()}<\/script></body></html>`)
  w.document.close()
}

/**
 * Sobe uma versão editada fora do sistema como NOVA versão da minuta.
 * Aceita texto colado ou arquivo .txt/.md — .docx e .pdf ficam de fora de
 * propósito: extrair texto deles no navegador daria resultado incerto, e uma
 * minuta com formatação perdida em silêncio é pior que um aviso claro.
 */
export async function subirVersaoMinuta(
  solicitacaoId: string, conteudo: string, descricao: string,
): Promise<{ versao: number }> {
  const texto = (conteudo ?? '').trim()
  if (!texto) throw new Error('O conteúdo está vazio.')
  if (!descricao.trim()) throw new Error('Descreva o que esta versão contém.')

  const { data: ultima } = await supabase.from('minutas')
    .select('versao, tipo, qualificacao').eq('solicitacao_id', solicitacaoId)
    .order('versao', { ascending: false }).limit(1).maybeSingle()

  const versao = ((ultima as any)?.versao ?? 0) + 1
  const { data, error } = await supabase.from('minutas').insert({
    solicitacao_id: solicitacaoId, versao,
    tipo: (ultima as any)?.tipo ?? 'provisoria',
    conteudo: texto, hash: await sha256(texto),
    qualificacao: [], origem: 'upload_usuario', descricao: descricao.trim(),
  }).select('id, versao').single()
  if (error) throw error

  await supabase.rpc('registrar_custodia', {
    p_solicitacao: solicitacaoId, p_minuta: (data as any).id,
    p_acao: 'minuta_editada', p_detalhe: { versao, origem: 'upload_usuario', descricao: descricao.trim() },
  })
  return { versao: (data as any).versao }
}
