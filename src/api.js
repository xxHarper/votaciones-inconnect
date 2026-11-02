export async function request(
  path,
  {
    token,
    csrf,
    body,
    method = "GET",
    file = false,
    download = false,
    ...rest
  } = {},
) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body && !file ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body ? { body: file ? body : JSON.stringify(body) } : {}),
    ...rest,
  });
  if (!res.ok) {
    const e = await res
      .json()
      .catch(() => ({ error: "No fue posible conectar con el servidor." }));
    const err = new Error(e.error);
    err.status = res.status;
    throw err;
  }
  return download ? res.blob() : res.json();
}
export function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
