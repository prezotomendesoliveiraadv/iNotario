import { useAtendimento } from './atendimento/useAtendimento'
import TelaEscolha from './atendimento/TelaEscolha'
import TelaConversa from './atendimento/TelaConversa'
import TelaConcluido from './atendimento/TelaConcluido'

/**
 * /atender — atendimento público conduzido pela Artemis.
 *
 * Esta página é só o roteador dos três passos. A máquina de estado vive em
 * useAtendimento e as telas são componentes de apresentação.
 */
export default function PortalAtendimento() {
  const at = useAtendimento()

  if (at.step === 'ok') return <TelaConcluido at={at} />
  if (at.step === 'escolha') return <TelaEscolha at={at} />
  return <TelaConversa at={at} />
}
