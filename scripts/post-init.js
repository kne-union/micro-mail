const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const configPath = path.resolve(projectRoot, 'portal.config.json');

const removeDir = target => {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const run = () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { includeTenantAdmin, includeTenantClient, includeClient, includeDingtalk, includeWecom, includeOidc } = config;
  const componentsDir = path.resolve(projectRoot, 'src/components');
  const serverDir = path.resolve(projectRoot, 'server');

  if (!includeTenantAdmin) {
    removeDir(path.resolve(componentsDir, 'TenantAdmin'));
  }

  if (!includeTenantClient) {
    removeDir(path.resolve(componentsDir, 'TenantClient'));
  }

  if (!includeClient) {
    removeDir(path.resolve(componentsDir, 'Client'));
  }

  if (!((includeTenantAdmin || includeTenantClient) && (includeDingtalk || includeWecom))) {
    removeDir(path.resolve(serverDir, 'libs/tasks'));
    removeDir(path.resolve(serverDir, 'libs/utils'));
  }

  if (includeOidc === false) {
    removeDir(path.resolve(projectRoot, 'src/commons/oidcClient.js'));
  }
};

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
