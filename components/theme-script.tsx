export default function ThemeScript() {
  const code = `
  try {
    var s = localStorage.getItem('theme');
    var d = s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (d) document.documentElement.classList.add('dark');
  } catch {}
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
