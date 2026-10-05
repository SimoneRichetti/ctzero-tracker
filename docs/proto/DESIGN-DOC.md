# CTZero Tracker

Ho bisogno di un tool che mi permetta di tracciare il prezzo di alcune carte che voglio comprare su cardtrader e mi avvisi quando queste calano di prezzo, per comprarle ad un prezzo conveniente. Questo sistema di si compone di 2 componenti:
- L'engine che prende le carte in tracciamento, ogni tot tempo interroga ctzero per aggiornare il prezzo e gestisce la notifica
- Il frontend che permette di aggiungere/rimuovere carte, vedere l'ultimo prezzo, l'ultima data di sync, triggerare un sync manuale

Vado nel dettaglio delle features richieste:

# B1 - Card tracking
Il sistema deve poter prendere in carico il tracciamento di carte di Magic The Gathering. Per ogni carta voglio poter specificare il nome ed eventuali condizioni che deve soddisfare: espansione (una o più specifiche o qualsiasi), lingua (una o più specifiche o qualsiasi), condizione minima (near mint, played, ecc), foil (true/false). Inoltre, ad ogni carta deve essere associata una threshold di prezzo: quando il prezzo è pari o inferiore alla treshold, deve scattare la notifica all'utente (es. via mail). Quando aggiungo il tracciamento di una carta, il sistema deve recuperare il pricing corrente e propormi delle treshold prefissate (-10%, -20%, minimo degli ultimi 6 mesi, 1€, ...) oppure campo libero per decidere io la treshold.

Il tracking va fatto sul sistema di CardTrader prendendo in considerazione solo ed esclusivamente le carte vendute attraverso il sistema CardTrader Zero, nessuna eccezione a questa regola.

# B2 - Job scheduling e notifiche
Il sistema ogni tot tempo (ogni tot ore, ogni giorno alla tale ora, ...) deve aggiornare il pricing delle carte sotto tracciamento e lanciare l'euristica di notifica: alcune carte sono scese sotto alla soglia? erano già sotto soglia ma sono ulteriormente scese? Fai delle regole intelligenti e produci un report da inviarmi. Da decidere come mandarmelo: telegram? Whatsapp? Email?

# B3 - User interface
Il sistema deve essere dotato di una comoda interfaccia grafica che mi permetta di:
- aggiungere il tracciamento di una carta, specificando le condizioni e la treshold (con dei preset comodi proposti)
- visualizzare le carte in tracciamento, con il loro current price, la data di ultimo aggiornamento, la treshold, le condizioni richieste
- modificare i parametri legati ad una carta
- triggerare manualmente l'aggiornamento dei prezzi
