import type { ModelRequestOptions } from "../model-options.js";

export type OpenAiClientConfig = {
  apiKey: string;
  baseURL?: string;
  useChatCompletions: boolean;
  isOpenRouter: boolean;
  requestOptions?: ModelRequestOptions;
};
