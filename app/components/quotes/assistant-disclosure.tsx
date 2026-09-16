import type { QuoteAIDisclosure } from '../../lib/quote-ai-disclosure';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export function AssistantDisclosure({ locale, processing, onClose }: { locale: 'fr' | 'en'; processing: QuoteAIDisclosure; onClose: () => void }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="qp-modal"><DialogHeader>
    <DialogTitle>{t('Traitement par l’assistant', 'Assistant data processing')}</DialogTitle>
    <DialogDescription>{t(`Easy Quote envoie votre message, la conversation utile et le contenu de travail du devis à ${processing.providerName} pour cette demande. Les champs enregistrés du client et de l’entreprise, le numéro TVA, la référence, les dates, l’adresse du chantier et les conditions ne sont pas ajoutés au contexte. Si votre message contient des coordonnées client, elles sont transmises avec ce message et peuvent être copiées dans ce devis uniquement.`, `Easy Quote sends your message, the conversation needed to answer it, and the Quote work content to ${processing.providerName} for this request. Saved Customer and business fields, the VAT identifier, reference, dates, work-site address, and terms are not added to the context. If your message contains Customer details, they are sent with that message and may be copied into this Quote only.`)}</DialogDescription>
  </DialogHeader>
    <p>{t('Cette application est en développement. Les données envoyées à ce fournisseur peuvent être conservées ou utilisées pour améliorer ses services selon votre compte, votre région et les conditions applicables. N’envoyez pas de données sensibles ou confidentielles. Les conversations brutes ne sont pas écrites dans les journaux de l’application.', 'This application is in development. Data sent to this provider may be retained or used to improve its services depending on your account, region, and the applicable terms. Do not send sensitive or confidential data. Raw conversations are not written to application logs.')}</p>
    <p>{t('Relisez les modifications appliquées et utilisez Annuler si nécessaire. L’assistant ne peut ni publier, ni envoyer, ni accepter un devis. La saisie manuelle reste disponible.', 'Review applied changes and use Undo if needed. The assistant cannot publish, send, or accept a Quote. Manual editing remains available.')}</p>
    <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer" className="underline">{t('Conditions de l’API Gemini', 'Gemini API terms')}</a>
    <div className="qp-modal-actions"><Button variant="outline" onClick={onClose}>{t('Fermer', 'Close')}</Button></div>
  </DialogContent></Dialog>;
}
