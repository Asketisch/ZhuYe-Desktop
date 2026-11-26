export function pluginErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}
