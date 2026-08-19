export type AutomationErrorCode =
  | 'draft_not_object'
  | 'draft_version_unsupported'
  | 'draft_title_missing'
  | 'draft_summary_missing'
  | 'draft_macros_missing'
  | 'draft_rules_missing'
  | 'draft_macro_not_object'
  | 'draft_macro_ref_missing'
  | 'draft_macro_ref_duplicate'
  | 'draft_macro_name_missing'
  | 'draft_macro_steps_invalid'
  | 'draft_rule_not_object'
  | 'draft_invalid_rule_shape'
  | 'draft_trigger_invalid'
  | 'draft_actions_empty'
  | 'draft_action_invalid'
  | 'draft_hold_actions_invalid'
  | 'draft_condition_invalid'
  | 'draft_macro_ref_missing_target'
  | 'draft_materialize_macro_ref_missing'
  | 'ai_endpoint_missing'
  | 'ai_model_missing'
  | 'ai_prompt_missing'
  | 'ai_invalid_json'
  | 'ai_endpoint_invalid'
  | 'ai_endpoint_scheme'
  | 'ai_remote_http_forbidden'
  | 'ai_messages_empty'
  | 'ai_messages_too_many'
  | 'ai_message_too_large'
  | 'ai_client_create_failed'
  | 'ai_provider_unavailable'
  | 'ai_response_read_failed'
  | 'ai_provider_http'
  | 'ai_provider_invalid_json'
  | 'ai_provider_content_missing'
  | 'pack_not_object'
  | 'pack_format_invalid'
  | 'pack_version_unsupported'
  | 'pack_id_missing'
  | 'pack_name_missing'
  | 'pack_description_missing'
  | 'pack_author_invalid'
  | 'pack_created_at_missing'
  | 'pack_payload_missing'
  | 'pack_rules_invalid'
  | 'pack_macros_invalid'
  | 'pack_layers_invalid'
  | 'pack_folders_invalid'
  | 'pack_too_large'
  | 'pack_too_many_rules'
  | 'pack_too_many_macros'
  | 'pack_too_many_layers'
  | 'pack_too_many_folders'
  | 'pack_duplicate_macro_id'
  | 'pack_duplicate_layer_id'
  | 'pack_duplicate_folder_id'
  | 'pack_duplicate_rule_id'
  | 'pack_dangling_macro_id'
  | 'pack_dangling_layer_id'
  | 'pack_dangling_folder_id'
  | 'pack_dangling_parent_folder_id'
  | 'pack_folder_cycle'
  | 'pack_rule_actions_empty'
  | 'pack_invalid_rule_shape'
  | 'pack_invalid_macro_shape'
  | 'pack_invalid_layer_shape'
  | 'pack_invalid_folder_shape'
  | 'pack_invalid_json'

export class AutomationError extends Error {
  readonly code: AutomationErrorCode
  readonly details: Record<string, string | number>

  constructor(code: AutomationErrorCode, details: Record<string, string | number> = {}) {
    super(code)
    this.name = 'AutomationError'
    this.code = code
    this.details = details
  }
}

export function automationError(code: AutomationErrorCode, details?: Record<string, string | number>): never {
  throw new AutomationError(code, details)
}

export function isAutomationError(error: unknown): error is AutomationError {
  return error instanceof AutomationError
}
