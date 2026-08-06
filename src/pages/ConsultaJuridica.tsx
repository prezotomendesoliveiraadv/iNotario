import { Layout } from '../components/ui'
import ConsultaJuridicaCard from '../components/ConsultaJuridicaCard'

export default function ConsultaJuridica() {
  return (
    <Layout>
      <div className="mb-4">
        <div className="text-[11px] font-semibold tracking-[.14em] text-brass uppercase">Apoio jurídico</div>
        <h1 className="font-serif text-2xl font-bold text-navy leading-tight">Consulta jurídica</h1>
        <p className="text-sm text-ink/60">
          Pergunte livremente ou analise um protocolo. A Artemis lê o acervo do cartório —
          jurisprudências e orientações do tabelião — e confronta com a legislação notarial,
          apontando convergências e divergências.
        </p>
      </div>
      <ConsultaJuridicaCard titulo="Nova consulta" />
    </Layout>
  )
}
