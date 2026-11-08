const path = `${location.pathname.replace(/\/$/, '')}/download`;
const image = document.querySelector('#wrap');
const status = document.querySelector('#status');
image.src = path;
document.querySelector('#download').href = path;
image.onerror = () => { status.textContent = 'Cannot load this wrap. The link may have expired; create a new export on your computer.'; status.className = 'error'; };
document.querySelector('#share').addEventListener('click', async () => {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error('This download link is no longer available.');
    const disposition = response.headers.get('Content-Disposition') || '';
    const name = disposition.match(/filename="([^"]+)"/)?.[1] || 'My_Wrap.png';
    const file = new File([await response.blob()], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My Model Y wrap' });
      status.textContent = 'Shared. You can now upload the PNG in Tesla Creations.';
    } else {
      status.textContent = 'Direct file sharing is unavailable on this connection. Tap Download PNG, then attach that file in your email app.';
    }
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? 'Sharing cancelled.' : error.message;
  }
});
