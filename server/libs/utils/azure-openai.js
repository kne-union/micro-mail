const { createAzure } = require('@ai-sdk/azure');

const getDeploymentName = (value, label) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${label} must be the Azure model deployment name (e.g. gpt-4o), not a resource URL. Check Azure Portal → Deployments.`);
  }
  return trimmed;
};

const createAzureClients = config => {
  const azure = createAzure({
    resourceName: config.AZURE_OPENAI_RESOURCE_NAME,
    baseURL: config.AZURE_OPENAI_BASE_URL,
    apiKey: config.AZURE_OPENAI_API_KEY,
    apiVersion: config.AZURE_OPENAI_API_VERSION || '2024-08-01-preview',
    useDeploymentBasedUrls: config.AZURE_OPENAI_USE_DEPLOYMENT_URLS !== 'false'
  });

  const chatDeployment = getDeploymentName(config.AZURE_OPENAI_CHAT_DEPLOYMENT, 'AZURE_OPENAI_CHAT_DEPLOYMENT');

  return {
    chatModel: azure.chat(chatDeployment)
  };
};

const assertAzureChatReady = config => {
  if (!config.AZURE_OPENAI_API_KEY || !config.AZURE_OPENAI_CHAT_DEPLOYMENT) {
    throw new Error('未配置 Azure OpenAI（需 AZURE_OPENAI_API_KEY 与 AZURE_OPENAI_CHAT_DEPLOYMENT）');
  }
  if (!config.AZURE_OPENAI_RESOURCE_NAME && !config.AZURE_OPENAI_BASE_URL) {
    throw new Error('未配置 Azure OpenAI（需 AZURE_OPENAI_RESOURCE_NAME 或 AZURE_OPENAI_BASE_URL）');
  }
};

module.exports = {
  createAzureClients,
  getDeploymentName,
  assertAzureChatReady
};
