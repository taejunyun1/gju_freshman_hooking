import { PRIVATE_CRAWLER_PATHS } from './shared/content/public-seo'

const PRIVATE_ROBOTS_HEADER = 'noindex, nofollow, noarchive'

const privateRouteRules = Object.fromEntries(
  PRIVATE_CRAWLER_PATHS.map(path => [
    `${path.endsWith('/') ? path.slice(0, -1) : path}/**`,
    { headers: { 'X-Robots-Tag': PRIVATE_ROBOTS_HEADER } },
  ]),
)

export default defineNuxtConfig({
  compatibilityDate: '2026-07-14',
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/css/fonts.css', '~/assets/css/tokens.css', '~/assets/css/main.css'],
  runtimeConfig: {
    supabaseSecretKey: '',
    phoneHmacKey: '',
    nameHmacKey: '',
    phoneEncryptionKey: '',
    passwordPepper: '',
    passwordPepperVersion: '',
    previousPasswordPepper: '',
    previousPasswordPepperVersion: '',
    public: {
      supabasePublishableKey: '',
      supabaseUrl: '',
    },
  },
  nitro: { preset: 'cloudflare-module' },
  routeRules: privateRouteRules,
  typescript: { strict: true, typeCheck: true },
  hooks: {
    'vite:extendConfig': async (config) => {
      // vite-plugin-checker shell-joins its absolute tsconfig path and cannot
      // build from a directory containing spaces. The standalone Nuxt
      // typecheck remains the authoritative check for this workspace.
      if (process.env.NODE_ENV === 'production' && /\s/u.test(process.cwd())) {
        const removeChecker = async (plugins: typeof config.plugins) => {
          if (!plugins) return
          for (let index = plugins.length - 1; index >= 0; index -= 1) {
            const plugin = await plugins[index]
            if (Array.isArray(plugin)) {
              await removeChecker(plugin)
            }
            else if (
              plugin
              && typeof plugin === 'object'
              && 'name' in plugin
              && plugin.name === 'vite-plugin-checker'
            ) {
              plugins.splice(index, 1)
            }
          }
        }
        await removeChecker(config.plugins)
      }
    },
  },
})
