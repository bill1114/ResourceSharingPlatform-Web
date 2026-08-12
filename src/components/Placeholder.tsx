// Temporary stand-in for screens not yet built (tracked in the project's task
// list — Dashboard/Map/CRUD screens/Edge-Function-backed workflows). Routing/nav
// is wired end-to-end now so each page can be filled in independently.
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="container mt-4">
      <div className="alert alert-info">
        <i className="bi bi-hourglass-split" /> <strong>{title}</strong> 畫面尚未實作，稍後會補上。
      </div>
    </div>
  )
}
