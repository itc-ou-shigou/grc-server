interface ErrorMessageProps {
  error: Error | null;
  message?: string;
}

export function ErrorMessage({ error, message }: ErrorMessageProps) {
  return (
    <div className="error-message">
      <span className="error-icon">⚠</span>
      <span>{message ?? error?.message ?? 'An unexpected error occurred.'}</span>
    </div>
  );
}
