import { useLocation } from 'react-router'

/** Shows where the router is, address and query, as text: a test finds it as the test id "where". */
export function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}
