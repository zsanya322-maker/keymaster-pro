export type RuleCommand = 'add' | 'edit' | 'delete';

export const RULE_COMMAND_EVENT = 'keymaster-rule-command';
export const RULE_SEARCH_EVENT = 'keymaster-rule-search';

export function emitRuleCommand(command: RuleCommand) {
  window.dispatchEvent(new CustomEvent<RuleCommand>(RULE_COMMAND_EVENT, { detail: command }));
}

export function emitRuleSearch(query: string) {
  window.dispatchEvent(new CustomEvent<string>(RULE_SEARCH_EVENT, { detail: query }));
}
