import { useLocation } from 'react-router'

/** Shows where the router is, as text: a test finds it as the test id "where". */
export function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
