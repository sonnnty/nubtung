/**
 * Parses a fetch Response as JSON. When the server (or a reverse proxy such as Cloudflare)
 * answers with an HTML error page instead, throws a readable error naming the HTTP status
 * rather than "Unexpected token '<' ... is not valid JSON".
 */
export async function readJson<T = any>(res: Response): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  const hint =
    res.status === 524 || res.status === 504 ? ' (เซิร์ฟเวอร์ใช้เวลานานเกินไป ลองใหม่อีกครั้ง)' :
    res.status === 413 ? ' (ไฟล์ใหญ่เกินไป)' :
    res.status === 502 || res.status === 503 ? ' (เซิร์ฟเวอร์ไม่พร้อมใช้งาน)' :
    res.redirected && res.url.includes('/login') ? ' (เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่)' :
    '';
  throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ: HTTP ${res.status}${hint}`);
}
