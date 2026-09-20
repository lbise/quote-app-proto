# Proposed disclosure and deterministic messages

Status: approval request only. These strings do not replace the current UI until #26 is approved and implemented. `{provider}` is the application's configured public provider name, never model-supplied text. Other placeholders below contain application-derived values, rendered as text rather than HTML.

## Assistant data-sharing disclosure

English:

```text
The assistant sends your current message, recent conversation and the complete current Working Draft to {provider}. This includes copied Customer and business details, VAT information, the Quote reference and dates, project and work-site details, terms, discounts, every line and section, and calculated amounts. It does not send unrelated Quotes, older Published Revisions, reusable-record directories or credentials.

This is broader sharing than the earlier work-only context. Do not enter sensitive, confidential or real Customer data until the provider, plan, region, retention and data-processing terms have been reviewed for your intended use. The provider may retain or use submitted data under its terms. This change does not approve real-data use.

The assistant can change only supported fields in this Working Draft. Copied Customer and business details belong to this Quote only. Review quantities, prices and wording before Publication. The assistant cannot create a Quote or later Working Draft, publish, send, accept or perform Undo. Use the manual controls for Publication and Undo.

Easy Quote does not write raw conversations, drafts or provider payloads to application logs. When debug mode is enabled, the authorized Quote viewer can see the exact application-level requests and attempted tool calls temporarily. These can contain the complete Working Draft and Customer details.
```

French:

```text
L'assistant transmet votre message, la conversation récente et l'intégralité du brouillon de travail actuel à {provider}. Cela comprend les coordonnées du client et de l'entreprise copiées dans ce devis, les informations de TVA, la référence et les dates du devis, le projet et l'adresse du chantier, les conditions, les remises, toutes les lignes et sections, ainsi que les montants calculés. Il ne transmet pas les autres devis, les anciennes versions publiées, les répertoires de fiches réutilisables ni les identifiants secrets.

Ce partage est plus large que l'ancien contexte limité aux travaux. Ne saisissez pas de données sensibles, confidentielles ou de données réelles de clients avant l'examen du fournisseur, de l'offre, de la région, des durées de conservation et des conditions de traitement pour l'usage prévu. Le fournisseur peut conserver ou utiliser les données selon ses conditions. Ce changement n'autorise pas l'utilisation de données réelles.

L'assistant ne peut modifier que les champs pris en charge dans ce brouillon. Les coordonnées du client et de l'entreprise copiées ici concernent uniquement ce devis. Vérifiez les quantités, les prix et les descriptions avant publication. L'assistant ne peut pas créer un devis ou un brouillon ultérieur, publier, envoyer, accepter ni annuler une action. Utilisez les commandes manuelles pour publier ou annuler une action.

Easy Quote n'écrit pas les conversations, brouillons ou données transmises au fournisseur dans les journaux de l'application. Lorsque le débogage est activé, la personne autorisée à consulter le devis peut voir temporairement les requêtes exactes de l'application et les appels d'outils tentés. Ces informations peuvent contenir le brouillon complet et les coordonnées du client.
```

Retain the existing nonblocking warning entry point and current provider-terms links. Update `app/lib/quote-ai-disclosure.ts`, `app/components/quotes/assistant-disclosure.tsx` and `docs/quote-ai.md` together. Update `docs/quote-review.md` and `docs/quote-workflow.md` wherever historical assistant limits or work-only sharing are described as current. Keep historical rehearsal results labelled historical. No existing production disclosure changes in this approval-only commit.

## Final status strings

These are application-authored status text, not model instructions or model assertions. Add the applicable status before an accepted reply, separated by two newlines. Discard uses only application status and the existing manual Retry action, never a model success reply.

| Outcome | English | French |
| --- | --- | --- |
| committed | Changes saved to this Working Draft. You can Undo this turn with the manual control. | Modifications enregistrées dans ce brouillon. Vous pouvez annuler ce tour avec la commande manuelle. |
| unchanged | No changes were made to this Working Draft. | Aucune modification n'a été apportée à ce brouillon. |
| discarded | Nothing from this turn was saved. Retry or continue manually. | Aucune modification de ce tour n'a été enregistrée. Réessayez ou continuez manuellement. |
| unresolved_failure | A tool call could not be corrected. Nothing from this turn was saved. Clarify your request or continue manually. | Un appel d'outil n'a pas pu être corrigé. Aucune modification de ce tour n'a été enregistrée. Précisez votre demande ou continuez manuellement. |
| recovery_exhausted | The three correction attempts were used. Nothing from this turn was saved. Retry with a clearer request or continue manually. | Les trois tentatives de correction ont été utilisées. Aucune modification de ce tour n'a été enregistrée. Précisez votre demande et réessayez, ou continuez manuellement. |
| stale | The Working Draft changed while the assistant was processing. Nothing from this turn was saved. | Le brouillon a changé pendant le traitement. Aucune modification de ce tour n'a été enregistrée. |
| draft_context_too_large | This complete Working Draft exceeds the assistant's size limit. Nothing was sent to the provider. Continue manually. | Ce brouillon complet dépasse la limite de taille de l'assistant. Aucune donnée n'a été envoyée au fournisseur. Continuez manuellement. |
| later_budget_exhausted | The assistant reached a processing limit. Nothing from this turn was saved. Continue manually or make a smaller request. | L'assistant a atteint une limite de traitement. Aucune modification de ce tour n'a été enregistrée. Continuez manuellement ou formulez une demande plus limitée. |

Use the pre-provider size message only if no request went to the provider. Provider-serialization failure on a later step uses later_budget_exhausted instead. A smaller request does not bypass the requirement to send the complete current draft.

Copied-value disclosure retains `copyDisclosure`'s current English/French wording and bounded row algorithm from `app/lib/quote-assistant.server.ts:48-77`, as transcribed in the current inventory. Inputs must reflect the final staged state, not obsolete values from an earlier copy call in the same turn. Omit copies deleted later in the same turn. Full untruncated accepted values remain in tool results; the visible list remains bounded.

## Debug panel

English warning:

```text
Sensitive debug data: these requests and tool calls may contain the complete Working Draft, Customer and business details, and conversation. Only authorized Quote viewers can see them here. They are temporary and are not stored in application logs. Credentials are excluded. Do not share this panel without removing personal and confidential data.
```

French warning:

```text
Données de débogage sensibles : ces requêtes et appels d'outils peuvent contenir le brouillon complet, les coordonnées du client et de l'entreprise, ainsi que la conversation. Seules les personnes autorisées à consulter ce devis peuvent les voir ici. Ces données sont temporaires et ne sont pas conservées dans les journaux de l'application. Les identifiants secrets sont exclus. Ne partagez pas ce panneau sans retirer les données personnelles et confidentielles.
```

| Label | English | French |
| --- | --- | --- |
| Counter | Correction attempts used: {used}/3 | Tentatives de correction utilisées : {used}/3 |
| Unresolved | Unresolved failed call: {failureId} | Appel en échec non résolu : {failureId} |
| Outcome | Turn outcome: {outcome} | Résultat du tour : {outcome} |
| Not sent | Not sent to the provider | Non transmis au fournisseur |

Use committed/enregistré, unchanged/inchangé and discarded/abandonné as localized outcome values. Include the initial failure at 0/3; do not label it attempt 1/3. Each diagnostic call record shows its own count, even if a later correction succeeds.

## Destructive requests, #28 only

| Request or result | English | French |
| --- | --- | --- |
| Ambiguous line target | Which lines should I delete? | Quelles lignes dois-je supprimer ? |
| Remove all work | I can't remove all work. Delete the work manually instead. | Je ne peux pas supprimer tous les travaux. Supprimez les travaux manuellement. |
| Remove a section | I can't delete a section. Delete the section manually instead. | Je ne peux pas supprimer une section. Supprimez la section manuellement. |
| Scope rejected after staging | Nothing from this turn was saved. Delete the work manually instead. | Aucune modification de ce tour n'a été enregistrée. Supprimez les travaux manuellement. |

`delete_quote_lines` can remove only 1 through 50 explicitly identified lines. It has no evidence, section or all-work target. A request that would remove every line present at the start of the turn discards the whole staged turn. Manual Undo reverses a committed permitted deletion.
