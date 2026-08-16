/** Error type for desktop-shell host plugin failures (always degraded, never fatal). */
export class DesktopShellError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DesktopShellError";
  }
}
