import { heading, info, success } from "./progress";
import { ValidationError } from "./cli";

interface HostDependency {
  command: string[];
  name: string;
  installHint: string;
  extraCheck?: () => Promise<string | null>;
}

const HOST_DEPENDENCIES: HostDependency[] = [
  {
    command: ["git", "--version"],
    name: "Git",
    installHint: "Install Git: https://git-scm.com/book/en/v2/Getting-Started-Installing-Git",
  },
  {
    command: ["gh", "--version"],
    name: "GitHub CLI (gh)",
    installHint: "Install GitHub CLI: https://cli.github.com/",
    extraCheck: async () => {
      const result = Bun.spawnSync(["gh", "auth", "status"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString();
        if (stderr.includes("not logged") || stderr.includes("no token") || stderr.includes("not authenticated")) {
          return (
            "GitHub CLI is not authenticated. Run `gh auth login` or set GITHUB_TOKEN/GH_TOKEN in your shell environment.\n" +
            "  See: https://docs.github.com/en/github-cli/github-cli/gh-auth-login"
          );
        }
        const stdout = result.stdout.toString();
        if (!stdout.includes("Logged in") && !stdout.includes("account")) {
          return (
            "GitHub CLI authentication could not be verified. Run `gh auth status` to check.\n" +
            "  If not logged in, run `gh auth login` or set GITHUB_TOKEN/GH_TOKEN."
          );
        }
      }
      return null;
    },
  },
  {
    command: ["docker", "--version"],
    name: "Docker",
    installHint: "Install Docker: https://docs.docker.com/get-docker/",
    extraCheck: async () => {
      const result = Bun.spawnSync(["docker", "info"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) {
        return "Docker daemon is not running. Start Docker Desktop or the Docker service.";
      }
      return null;
    },
  },
  {
    command: ["docker", "compose", "version"],
    name: "Docker Compose",
    installHint: "Install Docker Compose: https://docs.docker.com/compose/install/",
  },
];

export async function checkDependencies(): Promise<void> {
  heading("Checking Host Dependencies");

  const failures: string[] = [];

  for (const dep of HOST_DEPENDENCIES) {
    try {
      const result = Bun.spawnSync(dep.command, {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (result.exitCode !== 0) {
        failures.push(`  ✗ ${dep.name} — not found. ${dep.installHint}`);
        continue;
      }

      if (dep.extraCheck) {
        const extraErr = await dep.extraCheck();
        if (extraErr) {
          failures.push(`  ✗ ${dep.name} — ${extraErr}`);
          continue;
        }
      }

      const version = result.stdout.toString().split("\n")[0]?.trim() || "";
      info(`${dep.name}: ✓ ${version}`);
    } catch {
      failures.push(`  ✗ ${dep.name} — not found. ${dep.installHint}`);
    }
  }

  if (failures.length > 0) {
    throw new ValidationError(
      "Missing host dependencies:\n" +
        failures.join("\n") +
        "\n\nPlease install the missing dependencies and try again.",
    );
  }

  success("All host dependencies satisfied");
}
