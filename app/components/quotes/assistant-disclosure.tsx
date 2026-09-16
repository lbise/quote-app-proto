import type { QuoteAIDisclosure } from '../../lib/quote-ai-disclosure';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

export function AssistantDisclosure({ locale, processing, onClose, onContinue }: { locale: 'fr' | 'en'; processing: QuoteAIDisclosure; onClose: () => void; onContinue?: () => void }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const disabled = processing.mode === 'disabled';
  const fictional = processing.mode === 'fictional-test';
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="qp-modal"><DialogHeader>
    <DialogTitle>{t('Traitement par l’assistant', 'Assistant data processing')}</DialogTitle>
    <DialogDescription>{disabled
      ? t('L’assistant IA hébergé est désactivé. Easy Quote n’envoie aucun contenu de devis à un fournisseur IA.', 'Hosted AI is disabled. Easy Quote does not send Quote content to an AI provider.')
      : t(`Easy Quote envoie votre message, la conversation utile et le contenu de travail du devis à ${processing.providerName} pour cette demande. Les champs enregistrés du client et de l’entreprise, le numéro TVA, la référence, les dates, l’adresse du chantier et les conditions ne sont pas ajoutés au contexte. Si votre message contient des coordonnées client, elles sont transmises avec ce message et peuvent être copiées dans ce devis uniquement.`, `Easy Quote sends your message, the conversation needed to answer it, and the Quote work content to ${processing.providerName} for this request. Saved Customer and business fields, the VAT identifier, reference, dates, work-site address, and terms are not added to the context. If your message contains Customer details, they are sent with that message and may be copied into this Quote only.`)}</DialogDescription>
  </DialogHeader>
    {!disabled && <p>{fictional
      ? t('Cette instance exécute le test fictif isolé. N’y saisissez que des identités, clients, prix et conversations fictifs. Les services Gemini gratuits peuvent utiliser le contenu pour améliorer leurs produits et le faire examiner par des personnes. Vérifiez les conditions du service et de votre région. Ce test ne constitue ni une approbation sans entraînement ni une validation pour la production. Les conversations brutes ne sont pas écrites dans les journaux de l’application.', 'This instance runs the isolated fictional test. Enter only fictional identities, Customers, prices, and conversations. Unpaid Gemini services may use content for product improvement and human review. Check the service and regional terms. This test establishes neither no-training approval nor production readiness. Raw conversations are not written to application logs.')
      : t('Cette instance utilise la configuration de production soumise à une revue opérateur enregistrée. Le drapeau de configuration ne prouve pas à lui seul une approbation de traitement de données réelles. Vérifiez la revue applicable avant d’envoyer des données réelles. Les conversations brutes ne sont pas écrites dans les journaux de l’application.', 'This instance uses production configuration subject to a recorded operator review. The configuration flag alone does not prove approval for real-data processing. Verify the applicable review before sending real data. Raw conversations are not written to application logs.')}</p>}
    <p>{t('Relisez les modifications appliquées et utilisez Annuler si nécessaire. L’assistant ne peut ni publier, ni envoyer, ni accepter un devis. La saisie manuelle reste disponible sans IA.', 'Review applied changes and use Undo if needed. The assistant cannot publish, send, or accept a Quote. Manual editing remains available without AI.')}</p>
    {!disabled && <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer" className="underline">{t('Conditions de l’API Gemini', 'Gemini API terms')}</a>}
    <div className="qp-modal-actions"><Button variant="outline" onClick={onClose}>{t('Fermer', 'Close')}</Button>{onContinue && !disabled && <Button onClick={onContinue}>{t('Continuer et envoyer', 'Continue and send')}</Button>}</div>
  </DialogContent></Dialog>;
}
