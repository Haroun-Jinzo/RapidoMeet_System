---
name: phone_call
version: "1.0"
trigger: phone, appel, téléphone, call, mobile, conversation téléphonique
---

## Instructions pour appels téléphoniques

Priorités d'extraction :
- Identifier les participants à l'appel
- Extraire les tâches/action items même si la formulation est informelle
- Repérer les décisions prises, même implicites
- Détecter tout prospect ou opportunité commerciale mentionnée

Actions à déclencher :
- Si un suivi est mentionné → créer une tâche de rappel (automatique)
- Si un contact ou prospect est évoqué → log_activity ou create_contact dans RapidoCRM
- Toujours → send_recap aux participants

Format du rapport :
- Résumé en 2-3 phrases du contenu de l'appel
- Liste des tâches/action items avec assigné si possible
- Décisions prises, même si informelles
- Prospects/opportunités détectés