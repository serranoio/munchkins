import { join } from 'node:path';
import {
  AgentBuilder,
  gitWorktreeSandbox,
  Prompt,
  registry,
} from '@serranolabs.io/munchkins-core';
import {
  DEFAULT_CHECKS,
  defaultFixer,
  defaultSummaryWriter,
  GUIDELINES_PATH,
  getAgentPromptsDir,
  REFACTORER_PATH,
} from '../_shared/presets.js';

const PROMPTS = getAgentPromptsDir(import.meta.url);

const builder = new AgentBuilder(
  'bug-fix',
  'Fix a bug described in a markdown user-message file.',
  gitWorktreeSandbox()
)
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(join(PROMPTS, 'bug-fix.md'))
      .withUserMessageFromOption('userMessage', {
        required: true,
        description: 'Path to a markdown file describing the bug',
      })
  )
  .add(
    new Prompt(GUIDELINES_PATH)
      .withSystem(REFACTORER_PATH)
      .withUserMessage(
        'Refactor only files touched by the previous step. Do not expand scope.'
      )
  )
  .addDeterministic([...DEFAULT_CHECKS], {
    loop: { maxIterations: 3, fixer: defaultFixer() },
  })
  .summaryWriter(defaultSummaryWriter());

registry.register(builder);

export { builder };
