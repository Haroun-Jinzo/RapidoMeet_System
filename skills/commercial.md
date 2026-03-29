---
name: commercial
version: "1.2"
trigger: prospect, devis, client, vente, commercial, pipeline, offre, contrat
---

## Instructions pour réunions commerciales

Priorités d'extraction :
- Identifier TOUS les prospects mentionnés
- Extraire les engagements chiffrés (montants, délais)
- Détecter le niveau d'intérêt : chaud / tiède / froid

Actions à déclencher :
- Si nouveau contact → create_contact dans RapidoCRM (CRITIQUE — confirmation requise)
- Si RDV convenu → create_event dans Calendar (automatique)
- Toujours → log_activity sur le contact existant
- Toujours → send_recap aux participants

Format du rapport :
- Prospects en premier avec leur score
- Tâches triées par priorité
- Next steps en conclusion
