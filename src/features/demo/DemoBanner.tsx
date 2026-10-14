/** A strip across the top of a demo build, so nobody mistakes it for the real system. */
export function DemoBanner() {
  return (
    <aside role="note" className="demo-banner">
      מצב הדגמה: האפליקציה לא מחוברת לשרת, ושום דבר לא נשמר.
    </aside>
  )
}
