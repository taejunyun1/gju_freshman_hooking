import { handlePublicExploreRequest } from '../../utils/public-explore-request'
export default defineEventHandler(event => handlePublicExploreRequest(event, 'options'))
