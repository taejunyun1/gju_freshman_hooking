import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { renderCurriculumRoutesHtml } from '../shared/content/curriculum-routes-html'

const output = resolve(process.cwd(), 'public/curriculum-routes.html')

await mkdir(dirname(output), { recursive: true })
await writeFile(output, renderCurriculumRoutesHtml(), 'utf8')
