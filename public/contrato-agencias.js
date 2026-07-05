const canvas = document.querySelector('#signature');
const ctx = canvas.getContext('2d');
const form = document.querySelector('#contractForm');
const result = document.querySelector('#result');
let drawing = false;
let signed = false;

ctx.lineWidth = 3;
ctx.lineCap = 'round';
ctx.strokeStyle = '#18211f';

const point = event => {
  const rect = canvas.getBoundingClientRect();
  const source = event.touches?.[0] || event;
  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height)
  };
};

function start(event) {
  drawing = true;
  signed = true;
  const p = point(event);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function move(event) {
  if (!drawing) return;
  event.preventDefault();
  const p = point(event);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

function end() {
  drawing = false;
}

canvas.addEventListener('mousedown', start);
canvas.addEventListener('mousemove', move);
window.addEventListener('mouseup', end);
canvas.addEventListener('touchstart', start, { passive: false });
canvas.addEventListener('touchmove', move, { passive: false });
canvas.addEventListener('touchend', end);

document.querySelector('#clearSignature').addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  signed = false;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!signed) {
    alert('Falta la firma.');
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  data.acceptContract = Boolean(data.acceptContract);
  data.acceptPrivacy = Boolean(data.acceptPrivacy);
  data.acceptAuthority = Boolean(data.acceptAuthority);
  data.signatureDataUrl = canvas.toDataURL('image/png');

  const res = await fetch('/api/contracts/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
  const body = await res.json();
  if (!res.ok) {
    alert(body.error || 'No se pudo enviar el contrato.');
    return;
  }
  form.classList.add('hidden');
  result.classList.remove('hidden');
  result.innerHTML = `
    <h1>Contrato recibido</h1>
    <p>${body.message}</p>
    <p><a class="button-link" href="${body.downloadUrl}" target="_blank">Descargar documento firmado</a></p>
    <p class="muted">Conserva una copia. PROYEKTA revisará el contrato y activará la agencia cuando corresponda.</p>
  `;
});
