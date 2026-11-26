export function splitCodeMessage(text: string): { code: string | null; body: string } {
  const match = text.match(/^([A-Z0-9_]{3,}):\s*(.+)$/s);
  if (!match) return { code: null, body: text };
  return { code: match[1], body: match[2] };
}

export function ErrorMessage({ text }: { text: string }) {
  const { code, body } = splitCodeMessage(text);
  if (!code) return <span>{text}</span>;
  return (
    <span className="error-msg">
      <span>{body}</span>
      <code className="error-code">{code}</code>
    </span>
  );
}
