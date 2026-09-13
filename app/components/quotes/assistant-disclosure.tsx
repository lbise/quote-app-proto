import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export function AssistantDisclosure({ locale, onClose, onContinue }: { locale: 'fr' | 'en'; onClose: () => void; onContinue?: () => void }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="qp-modal"><DialogHeader>
    <DialogTitle>{t('Traitement par l’assistant', 'Assistant data processing')}</DialogTitle>
    <DialogDescription>{t('Votre message, la conversation utile et les détails des travaux du devis sont transmis à OpenAI. Les champs dédiés aux coordonnées, aux identités et aux conditions ne sont pas transmis. Les messages et descriptions peuvent toutefois contenir des données personnelles.', 'Your message, relevant conversation and Quote work details are sent to OpenAI. Dedicated contact, identity and terms fields are not sent. Messages and descriptions may still contain personal information.')}</DialogDescription>
  </DialogHeader>
    <p>{t('L’activation exige une configuration sans entraînement sur vos données. OpenAI peut conserver le contenu jusqu’à 30 jours pour prévenir les abus. Ne transmettez pas de documents sources ni de données personnelles inutiles. Les conversations ne sont pas écrites dans les journaux de l’application.', 'Enabling the assistant requires a configuration that does not train on your data. OpenAI may retain content for up to 30 days for abuse monitoring. Do not send source documents or unnecessary personal information. Conversations are not written to application logs.')}</p>
    <p>{t('Vérifiez chaque modification. L’assistant ne peut pas confirmer la publication. La saisie manuelle reste disponible sans IA.', 'Review every change. The assistant cannot confirm publication. Manual editing remains available without AI.')}</p>
    <div className="qp-modal-actions"><Button variant="outline" onClick={onClose}>{t('Fermer', 'Close')}</Button>{onContinue && <Button onClick={onContinue}>{t('Continuer et envoyer', 'Continue and send')}</Button>}</div>
  </DialogContent></Dialog>;
}
