/**
 * DemoForge CLI — heal command.
 *
 * Repairs broken selectors in demo scripts using LLM-assisted analysis.
 * Usage: demoforge heal [flows...]
 *
 * On failure:
 * 1. Captures current AX tree (via T10a_agent state serialization)
 * 2. Takes screenshot (T13_screenshots)
 * 3. Sends to LLM (T7_llm) with failing step, old selector, and new page state
 * 4. LLM proposes selector patch as reviewable diff (never auto-commits)
 * 5. Diff shows old vs new selector with explanation
 * 6. Accept/reject workflow: --accept flag for automated approval, interactive mode for manual review
 * 7. Healed script is validated against schema (T2) before saving
 */

import { Command } from "commander";
import {
  type Config,
  createLogger,
  validateDemoScript,
  LlmClient,
  LlmUnavailableError,
  HealError,
  type DemoScript,
  type FailingStep,
  type HealConfig,
  healStep,
  applyPatches,
  extractFailingStep,
} from "@demoforge/core";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import yaml from "js-yaml";
import { BrowserSession } from "@demoforge/browser";

// ─── Interface for interactive prompt ────────────────────────────────────────

interface InteractivePrompt {
  ask(question: string, options?: string[]): Promise<string>;
}

function createInteractivePrompt(): InteractivePrompt {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async ask(question, options): Promise<string> {
      const optionStr = options ? ` (${options.join("/")})` : "";
      const answer = await readline.question(`${question}${optionStr}: `);
      readline.close();
      return answer.trim().toLowerCase();
    },
  };
}

// ─── Script Loading ───────────────────────────────────────────────────────────

/**
 * Load a demo script from a file (JSON or YAML).
 */
function loadScript(filePath: string): DemoScript {
  const content = readFileSync(filePath, "utf-8");
  const ext = extname(filePath).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(content) as DemoScript;
  }

  if (ext === ".yaml" || ext === ".yml") {
    // For YAML files, use js-yaml
    const parsed = yaml.load(content) as DemoScript;
    return parsed;
  }

  throw new HealError(`Unsupported script format: ${ext}. Use .json, .yaml, or .yml.`);
}

/**
 * Save a demo script to a file.
 */
function saveScript(script: DemoScript, filePath: string): void {
  const ext = extname(filePath).toLowerCase();
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (ext === ".json") {
    writeFileSync(filePath, JSON.stringify(script, null, 2));
  } else {
    writeFileSync(filePath, yaml.dump(script));
  }
}

// ─── Healer Class ─────────────────────────────────────────────────────────────

/**
 * Healer manages the full heal flow for a demo script.
 */
class Healer {
  private logger: ReturnType<typeof createLogger>;
  private config: Config;

  constructor(logger: ReturnType<typeof createLogger>, config: Config) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Find demo scripts in the output directory.
   */
  findScripts(outputDir: string, flowFilters?: string[]): string[] {
    if (!existsSync(outputDir)) {
      throw new HealError(`No directory found at: ${outputDir}`);
    }

    const files = readdirSync(outputDir).filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext === ".json" || ext === ".yaml" || ext === ".yml";
    });

    if (flowFilters && flowFilters.length > 0) {
      return files.filter((f) =>
        flowFilters.some((filter) =>
          f.toLowerCase().includes(filter.toLowerCase())
        )
      );
    }

    return files;
  }

  /**
   * Identify which step in a script is failing.
   * In a full integration with the renderer, this would be driven by
   * the render failure error. For CLI usage, we accept a step index.
   */
  identifyFailingStep(
    script: DemoScript,
    stepIndex: number,
    error: string,
    url: string
  ): FailingStep | null {
    return extractFailingStep(script, stepIndex, error, url);
  }

  /**
   * Create a browser session for page state capture.
   */
  async createBrowserSession(): Promise<BrowserSession> {
    return new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });
  }

  /**
   * Create an LLM client for healing requests.
   */
  createLlmClient(): LlmClient {
    return new LlmClient({
      baseURL: this.config.llm.base_url,
      model: this.config.llm.model,
      timeout: 30000,
      maxRetries: 2,
    });
  }

  /**
   * Present a healing proposal to the user for review.
   * Returns true if the user accepts.
   */
  async presentProposal(
    proposal: {
      diff: string;
      patches: Array<{
        stepIndex: number;
        actionType: string;
        oldSelector: string;
        newSelector: string;
        explanation: string;
        confidence: number;
      }>;
    },
    accept: boolean
  ): Promise<boolean> {
    if (accept) {
      this.logger.info("Auto-accepting healing proposal (--accept flag)");
      return true;
    }

    // Interactive review mode
    this.logger.info("=== Healing Proposal ===");
    this.logger.info(proposal.diff);
    this.logger.info("");
    this.logger.info("Review the changes above.");
    this.logger.info("Type 'accept' to apply, 'reject' to skip, or 'modify' to review details.");

    const prompt = createInteractivePrompt();
    const answer = await prompt.ask("Your decision", ["accept", "reject"]);

    if (answer === "accept") {
      this.logger.info("Applying healing proposal...");
      return true;
    }

    this.logger.info("Skipping healing proposal.");
    return false;
  }

  /**
   * Execute the full heal flow for a single script and failing step.
   */
  async healScript(
    scriptPath: string,
    stepIndex: number,
    error: string,
    url: string,
    options: {
      accept?: boolean;
      outputDir?: string;
      llmClientConfig?: import("@demoforge/core").LlmClientConfig;
    } = {}
  ): Promise<{ success: boolean; script?: DemoScript; error?: string }> {
    const {
      accept = false,
      outputDir,
      llmClientConfig,
    } = options;

    this.logger.info(`Loading script: ${scriptPath}`);
    let script: DemoScript;

    try {
      script = loadScript(scriptPath);
    } catch (err) {
      return {
        success: false,
        error: `Failed to load script: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Identify the failing step
    const failingStep = this.identifyFailingStep(script, stepIndex, error, url);
    if (!failingStep) {
      return {
        success: false,
        error: `Could not identify a healable failing step at index ${stepIndex}. ` +
          `Only steps with selectors (click, hover, fill, select, wait_for) can be healed.`,
      };
    }

    this.logger.info(
      `Failing step ${stepIndex}: ${failingStep.actionType} on "${failingStep.oldSelector}"`
    );
    this.logger.info(`Error: ${failingStep.error}`);

    // Determine output path for healed script
    const resolvedOutputDir = outputDir ?? join(process.cwd(), ".demoforge");
    const healedPath = join(resolvedOutputDir, `healed-${basename(scriptPath)}`);

    // Create screenshot output path
    const screenshotPath = join(resolvedOutputDir, `heal-screenshot-${stepIndex}.png`);

    // Create browser session for page state capture
    let browser: BrowserSession | null = null;
    try {
      browser = await this.createBrowserSession();
      await browser.launch();

      // Navigate to the page state URL if available
      if (url) {
        try {
          await browser.goto(url);
          // Wait a bit for the page to settle
          await new Promise((r) => setTimeout(r, 2000));
        } catch (navErr) {
          this.logger.warn(
            `Could not navigate to page for state capture: ${navErr instanceof Error ? navErr.message : String(navErr)}`
          );
        }
      }

      // Create LLM client — always ensure we have an LlmClient instance
      let llmClient: LlmClient;
      if (llmClientConfig) {
        llmClient = new LlmClient(llmClientConfig);
      } else {
        llmClient = this.createLlmClient();
      }

      // Build heal config
      const healConfig: HealConfig & { failingStep: FailingStep } = {
        script,
        browser,
        llmClient: llmClient,
        outputDir: resolvedOutputDir,
        accept: accept,
        screenshotPath,
        failingStep,
      };

      // Execute healing
      const result = await healStep(healConfig);

      if (!result.success) {
        if (result.llmUnavailable) {
          this.logger.error(
            "LLM server is unavailable. Healing cannot proceed without LLM assistance."
          );
          this.logger.error(
            "Ensure llama-server or an OpenAI-compatible API is running."
          );
          return {
            success: false,
            error: result.error ?? "LLM unavailable",
          };
        }

        // Present the proposal for interactive review
        const proposal = {
          diff: result.proposals[0]?.diff ?? "No diff available",
          patches: result.proposals[0]?.patches ?? [],
        };

        const accepted = await this.presentProposal(proposal, accept);

        if (!accepted) {
          return {
            success: false,
            error: "Healing proposal was rejected.",
          };
        }

        // If accepted, apply patches manually
        const patches = result.proposals[0]?.patches ?? [];
        if (patches.length > 0) {
          const healed = applyPatches(script, patches);
          const validation = validateDemoScript(healed);

          if (!validation.success) {
            return {
              success: false,
              error: `Healed script failed schema validation: ${(validation as any).error.issues.map((i: any) => i.message).join("; ")}`,
            };
          }

          saveScript(healed, healedPath);
          this.logger.info(`Healed script saved to: ${healedPath}`);

          return {
            success: true,
            script: healed,
          };
        }

        return {
          success: false,
          error: result.error ?? "Healing failed without producing patches.",
        };
      }

      // Healing was successful
      if (result.script) {
        // Validate the healed script
        const validation = validateDemoScript(result.script);
        if (!validation.success) {
          return {
            success: false,
            error: `Healed script failed schema validation: ${(validation as any).error.issues.map((i: any) => i.message).join("; ")}`,
          };
        }

        saveScript(result.script, healedPath);
        this.logger.info(`Healed script saved to: ${healedPath}`);
        this.logger.info(`Applied ${result.patchesApplied} selector patch(es).`);

        return {
          success: true,
          script: result.script,
        };
      }

      return {
        success: false,
        error: "Healing completed but produced no output script.",
      };
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        this.logger.error(
          "LLM server is unreachable. Healing requires LLM assistance and cannot proceed."
        );
        this.logger.error(
          "Ensure llama-server or an OpenAI-compatible API is running at " +
          (llmClientConfig?.baseURL ?? this.config.llm.base_url)
        );
        return {
          success: false,
          error: `LLM unavailable: ${err.message}`,
        };
      }

      if (err instanceof HealError) {
        return {
          success: false,
          error: err.message,
        };
      }

      return {
        success: false,
        error: `Healing failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

// ─── CLI Command Factory ──────────────────────────────────────────────────────

export function createHealCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("heal")
    .description("Repair broken selectors in demo scripts using LLM-assisted analysis")
    .argument("[flows...]", "Flow names or script file patterns to heal (default: all scripts in .demoforge/)")
    .option("-a, --accept", "Automatically accept proposed repairs without review")
    .option("-o, --output <dir>", "Output directory for healed scripts (default: .demoforge)")
    .option("-s, --step <index>", "Step index to heal (default: auto-detect from render failure)")
    .option("-e, --error <message>", "Error message from render failure (for context)")
    .option("-u, --url <url>", "URL to navigate to for page state capture")
    .action(
      async (
        flows: string[],
        options: {
          accept?: boolean;
          output?: string;
          step?: string;
          error?: string;
          url?: string;
        }
      ) => {
        const outputDir = options.output ?? join(process.cwd(), ".demoforge");
        const stepIndex = options.step ? parseInt(options.step, 10) : -1;
        const error = options.error ?? "Selector not found or element not interactable";
        const url = options.url ?? "";

        logger.debug(`Healing ${flows.length > 0 ? flows.join(", ") : "all flows"}`);
        logger.debug(`Output directory: ${outputDir}`);

        const healer = new Healer(logger, config);
        let scripts: string[];

        try {
          scripts = healer.findScripts(outputDir, flows);
        } catch (err) {
          logger.error(err instanceof HealError ? err.message : String(err));
          process.exit(1);
        }

        if (scripts.length === 0) {
          logger.error("No demo scripts found matching the specified flows.");
          logger.error("Run 'demoforge explore' or 'demoforge render' first to generate scripts.");
          process.exit(1);
        }

        logger.info(`Found ${scripts.length} script(s) to heal.`);

        let overallSuccess = true;

        for (const scriptFile of scripts) {
          const scriptPath = join(outputDir, scriptFile);
          logger.info(`\nHealing: ${scriptFile}`);

          // If a specific step index was provided, heal that step
          if (stepIndex >= 0) {
            const result = await healer.healScript(scriptPath, stepIndex, error, url, {
              accept: options.accept,
              outputDir,
              llmClientConfig: {
                baseURL: config.llm.base_url,
                model: config.llm.model,
                timeout: 30000,
              },
            });

            if (!result.success) {
              logger.error(`Failed to heal ${scriptFile}: ${result.error}`);
              overallSuccess = false;
            } else {
              logger.info(`Successfully healed ${scriptFile}`);
            }
          } else {
            // Auto-detect: try to load and find steps that need healing
            // For now, list the scripts and require --step to be explicit
            logger.info(`Script: ${scriptFile}`);
            try {
              const script = loadScript(scriptPath);
              const stepCount = script.steps.length;
              logger.info(`  Steps: ${stepCount}`);

              // Show steps with selectors that could be healed
              const healableSteps: number[] = [];
              for (let i = 0; i < stepCount; i++) {
                const step = script.steps[i];
                if (step && ("click" in step || "hover" in step || "fill" in step || "select" in step || "wait_for" in step)) {
                  healableSteps.push(i);
                }
              }

              logger.info(`  Healable steps: ${healableSteps.join(", ") || "none"}`);
              logger.info(
                `Use --step <index> to heal a specific step, or provide --error and --url for context.`
              );
            } catch (loadErr) {
              logger.error(`Failed to load ${scriptFile}: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`);
              overallSuccess = false;
            }
          }
        }

        if (!options.accept && overallSuccess) {
          logger.info("\nUse --accept to automatically apply proposed repairs without review.");
        }

        if (!overallSuccess) {
          process.exit(1);
        }
      }
    );
}
