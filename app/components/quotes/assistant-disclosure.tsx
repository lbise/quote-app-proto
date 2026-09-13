import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export function AssistantDisclosure({ locale, onClose, onContinue }: { locale: 'fr' | 'en'; onClose: () => void; onContinue?: () => void }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="qp-modal"><DialogHeader>
    <DialogTitle>{t('Traitement par l’assistant', 'Assistant data processing')}</DialogTitle>
    <DialogDescription>{t('Votre message, la conversation utile, l’objet, les sections, les lignes et la remise du devis sont transmis à OpenAI. Les champs dédiés aux noms, adresses, contacts, numéro TVA, référence, dates, adresse du chantier et conditions ne sont pas transmis. Les messages et descriptions peuvent toutefois contenir des données personnelles.', 'Your message, relevant conversation, Quote title, sections, lines and discount are sent to OpenAI. Dedicated names, addresses, contacts, VAT identifier, reference, dates, work-site address and terms are not sent. Messages and descriptions may still contain personal information.')}</DialogDescription>
  </DialogHeader>
    <p>{t('L’activation exige une configuration sans entraînement sur vos données. OpenAI peut conserver le contenu jusqu’à 30 jours pour prévenir les abus. Ne transmettez pas de documents sources ni de données personnelles inutiles. Les conversations ne sont pas écrites dans les journaux de l’application.', 'Enabling the assistant requires a configuration that does not train on your data. OpenAI may retain content for up to 30 days for abuse monitoring. Do not send source documents or unnecessary personal information. Conversations are not written to application logs.')}</p>
    <p>{t('Les modifications appliquées sont enregistrées automatiquement. Relisez-les et utilisez Annuler si nécessaire. L’assistant ne peut ni publier, ni envoyer, ni accepter un devis. La saisie manuelle reste disponible sans IA.', 'Applied changes save automatically. Review them and use Undo if needed. The assistant cannot publish, send or accept a Quote. Manual editing remains available without AI.')}</p>
    <a href="https://platform.openai.com/docs/guides/your-data" target="_blank" rel="noreferrer" className="underline">{t('Politique de données de l’API OpenAI', 'OpenAI API data policy')}</a>
    <div className="qp-modal-actions"><Button variant="outline" onClick={onClose}>{t('Fermer', 'Close')}</Button>{onContinue && <Button onClick={onContinue}>{t('Continuer et envoyer', 'Continue and send')}</Button>}</div>
  </DialogContent></Dialog>;
}
