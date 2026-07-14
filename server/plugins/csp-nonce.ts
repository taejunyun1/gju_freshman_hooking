type RenderHtmlContext = {
  body: string[]
  bodyAppend: string[]
  bodyPrepend: string[]
  head: string[]
}

const renderedSections: Array<keyof RenderHtmlContext> = ['head', 'bodyPrepend', 'body', 'bodyAppend']
const scriptOpenTag = /<script(?=[\s>])(?![^>]*\snonce(?:\s*=|\s|>))/giu

export const applyScriptNonce = (html: RenderHtmlContext, nonce: string): void => {
  for (const section of renderedSections) {
    html[section] = html[section].map(chunk => chunk.replace(scriptOpenTag, `<script nonce="${nonce}"`))
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.cspNonce
    if (typeof nonce === 'string') applyScriptNonce(html, nonce)
  })
})
