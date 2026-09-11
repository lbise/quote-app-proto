// THROWAWAY design route for #8. Fictional, local-only state. Excluded from production routing.
import QuotePrototype from '../components/quote-prototype/workspace';
import '../components/quote-prototype/prototype.css';
export function meta() { return [{ title: 'Easy Quote · Layout prototype' }, { name: 'robots', content: 'noindex, nofollow' }]; }
export function loader() { if (import.meta.env.PROD) throw new Response('Not found', { status: 404 }); return null; }
export default QuotePrototype;
