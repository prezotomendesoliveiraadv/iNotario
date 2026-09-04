// ============================================================================
// Versão vigente do sistema
//
// Fonte única. Ao publicar uma versão nova, altere AQUI e em mais nenhum lugar
// — o rodapé, o diagnóstico e qualquer relatório leem daqui.
//
// Existe por um motivo prático: durante a implantação da v8, deploys
// "bem-sucedidos" subiram código antigo por duas sessões seguidas, e não havia
// como olhar a tela e saber qual versão estava no ar.
// ============================================================================

export const APP_VERSAO = '9.5'
export const APP_DATA = '2026-08-30'

/** Última migration que esta versão do front espera encontrar no banco. */
export const MIGRATION_ESPERADA = 23

/** Rótulo curto para o rodapé. */
export const versaoCurta = () => `v${APP_VERSAO}`

/** Rótulo completo, para relatórios e mensagens de suporte. */
export const versaoCompleta = () =>
  `iNotário v${APP_VERSAO} (${APP_DATA}) · banco esperado: ${MIGRATION_ESPERADA}ª migration`
