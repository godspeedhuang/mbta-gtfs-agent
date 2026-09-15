import {tool} from 'ai';
import {AskUserParams, TOOL_DESCRIPTIONS, type AskUserOutput} from './tool-schemas';

// ask_user rides on the AI SDK approval flow: sqlrooms pauses the loop and renders the tool's UI while approval is
// requested. The UI stores the user's choices here, then approves; execute runs next and returns them to the model.
const answers = new Map<string, AskUserOutput>();

export function setAskUserAnswers(toolCallId: string, output: AskUserOutput) {
  answers.set(toolCallId, output);
}

export function createAskUserTool() {
  // For a yes/no confirmation, choosing "No, something else" arrives as `other` with the user's text.
  return tool({
    description: TOOL_DESCRIPTIONS.ask_user,
    inputSchema: AskUserParams,
    needsApproval: true,
    execute: async (_input, {toolCallId}): Promise<AskUserOutput> => {
      const out = answers.get(toolCallId);
      answers.delete(toolCallId);
      // A reload loses the in-memory answers; tell the model instead of inventing choices.
      return out ?? {answers: [], note: 'No answer was recorded. Ask again or proceed with stated defaults.'};
    },
  });
}
