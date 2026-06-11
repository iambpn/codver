import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { readConfig, writeConfig, validateConfig } from '../config/store';

export function createConfigCommand(): Command {
  const configCmd = new Command('config').description('Manage CLI configuration');

  configCmd
    .command('init')
    .description('Interactive configuration wizard')
    .action(async () => {
      const existing = readConfig();
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'serverUrl',
          message: 'Server URL:',
          default: existing.serverUrl || 'http://localhost:3000',
        },
        {
          type: 'password',
          name: 'apiKey',
          message: 'API Key:',
          mask: '*',
        },
      ]);

      writeConfig({
        serverUrl: answers.serverUrl,
        apiKey: answers.apiKey,
      });

      console.log(chalk.green('Configuration saved to ~/.codver/config.json'));
    });

  configCmd
    .command('set-server')
    .description('Set server URL')
    .argument('<url>', 'Server URL')
    .action((url: string) => {
      const config = readConfig();
      config.serverUrl = url;
      writeConfig(config);
      console.log(chalk.green(`Server URL set to: ${url}`));
    });

  configCmd
    .command('set-key')
    .description('Set API key')
    .argument('<key>', 'API key')
    .action((key: string) => {
      const config = readConfig();
      config.apiKey = key;
      writeConfig(config);
      console.log(chalk.green('API key saved.'));
    });

  configCmd
    .command('view')
    .description('Show current configuration')
    .action(() => {
      const config = readConfig();
      const { valid, errors } = validateConfig(config);

      if (!valid) {
        console.log(chalk.yellow('Configuration incomplete:'));
        errors.forEach((e) => console.log(chalk.yellow(`  - ${e}`)));
      }

      console.log(`Server: ${config.serverUrl || chalk.gray('(not set)')}`);
      console.log(`API Key: ${config.apiKey ? '****' : chalk.gray('(not set)')}`);
    });

  return configCmd;
}
