import nitroWorker from '../.output/server/index.mjs'
import { createBodyGuardWorker } from './request-body-guard.mjs'

export default createBodyGuardWorker(nitroWorker)
