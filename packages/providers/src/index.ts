// Public API of @shellnote/providers.
export { guessCaps, pageFor, sizeFromName, SMALL_PAGE_UNDER, takesTemperature, type PageSetting, type TerminalPage } from './caps.js'
export { embeddingModels, embeddingPrefix, lmStudioEmbedder } from './embed.js'
export { forgetThinkers, listModels, LOCAL_THINKING_ROOM, openAICompatible, THINKING_ROOM, type Effort, type OpenAIOptions } from './openai.js'
export { capsFor, OPENROUTER, openRouter, openRouterModels, toHosted, type HostedModel, type OpenRouterOptions } from './openrouter.js'
