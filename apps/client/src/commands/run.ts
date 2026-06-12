import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { ApiClient } from '../api/client';

interface JobCreateResponse {
  jobId: string;
  status: string;
}

export function createRunCommand(): Command {
  return new Command('run')
    .description('Submit a new coding job')
    .requiredOption('--repo <url>', 'Repository URL')
    .option('--branch <branch>', 'Git branch', 'main')
    .requiredOption('--prompt <prompt>', 'Task prompt (use --prompt-file for files)')
    .option('--prompt-file <path>', 'Read prompt from a file')
    .option('--model <model>', 'AI model to use (e.g., claude-sonnet-4, gpt-4o)')
    .option('--provider <provider>', 'AI provider (anthropic, openai, google)')
    .option('--thinking <level>', 'Thinking level (off, minimal, low, medium, high)')
    .option('--images <files...>', 'Attach images to the prompt')
    .option('--files <files...>', 'Attach additional resource files')
    .option('--webhook <url>', 'Webhook URL for job completion/failure notifications')
    .option('--timeout <minutes>', 'Job timeout in minutes (1-240)', '30')
    .option('--memory <limit>', 'Container memory limit (e.g., 2g, 4g)', '4g')
    .option('--cpu <cores>', 'Container CPU limit (e.g., 1, 2)', '2')
    .option('--network <mode>', 'Network access mode (none, limited, full)', 'limited')
    .option('--env <vars...>', 'Custom environment variables (KEY=VALUE format)')
    .action(async (options: {
      repo: string;
      branch: string;
      prompt: string;
      promptFile?: string;
      model?: string;
      provider?: string;
      thinking?: string;
      images?: string[];
      files?: string[];
      webhook?: string;
      timeout?: string;
      memory?: string;
      cpu?: string;
      network?: string;
      env?: string[];
    }) => {
      try {
        const client = new ApiClient();

        // Read prompt from file if specified
        let finalPrompt = options.prompt;
        if (options.promptFile) {
          const promptPath = path.resolve(options.promptFile);
          if (!fs.existsSync(promptPath)) {
            console.error(chalk.red(`Prompt file not found: ${promptPath}`));
            process.exit(1);
          }
          const fileContent = fs.readFileSync(promptPath, 'utf-8');
          finalPrompt = finalPrompt ? `${finalPrompt}\n\n${fileContent}` : fileContent;
          console.log(chalk.gray(`Read prompt from ${options.promptFile} (${fileContent.length} chars)`));
        }

        // Process images
        let imageAttachments: { filename: string; data: string; mediaType: string }[] | undefined;
        if (options.images && options.images.length > 0) {
          imageAttachments = [];
          for (const imgPath of options.images) {
            const resolvedPath = path.resolve(imgPath);
            if (!fs.existsSync(resolvedPath)) {
              console.error(chalk.red(`Image file not found: ${resolvedPath}`));
              process.exit(1);
            }
            const buffer = fs.readFileSync(resolvedPath);
            const ext = path.extname(resolvedPath).toLowerCase().replace('.', '');
            const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            imageAttachments.push({
              filename: path.basename(resolvedPath),
              data: buffer.toString('base64'),
              mediaType,
            });
          }
          console.log(chalk.gray(`Attached ${imageAttachments.length} image(s)`));
        }

        // Process additional files
        let additionalFiles: string[] | undefined;
        if (options.files && options.files.length > 0) {
          additionalFiles = options.files.map((f) => path.resolve(f));
          console.log(chalk.gray(`Attached ${additionalFiles.length} additional file(s)`));
        }

        // Process env vars
        let envVars: Record<string, string> | undefined;
        if (options.env && options.env.length > 0) {
          envVars = {};
          for (const envVar of options.env) {
            const eqIdx = envVar.indexOf('=');
            if (eqIdx === -1) {
              console.error(chalk.red(`Invalid env var format (expected KEY=VALUE): ${envVar}`));
              process.exit(1);
            }
            const key = envVar.slice(0, eqIdx);
            const value = envVar.slice(eqIdx + 1);
            envVars[key] = value;
          }
          console.log(chalk.gray(`Set ${Object.keys(envVars).length} custom env var(s)`));
        }

        const payload: Record<string, unknown> = {
          repoUrl: options.repo,
          branch: options.branch,
          prompt: finalPrompt,
          model: options.model,
          provider: options.provider,
          thinkingLevel: options.thinking,
          images: imageAttachments,
          additionalFiles,
          webhookUrl: options.webhook,
          timeoutMs: options.timeout ? parseInt(options.timeout) * 60 * 1000 : undefined,
          memoryLimit: options.memory,
          cpuLimit: options.cpu,
          networkAccess: options.network,
          envVars,
        };

        const res = await client.post<JobCreateResponse>('/jobs', payload);

        if (res.success && res.data) {
          console.log(chalk.green(`Job submitted: ${res.data.jobId}`));
          console.log(`Track with: codver status --job-id ${res.data.jobId}`);
          console.log(`Stream logs: codver logs --job-id ${res.data.jobId} --follow`);
        } else {
          console.error(chalk.red(`Failed to submit job: ${res.error || 'Unknown error'}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Failed to submit job: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
