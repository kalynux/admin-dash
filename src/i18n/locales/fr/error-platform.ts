/**
 * Refus délégués, indexés sur `details.platformCode`.
 *
 * Les clés sont des codes du backend et ne sont jamais traduites ; seules les
 * phrases le sont. Voir le fichier anglais pour la provenance de chaque texte —
 * plusieurs portent une nuance qui n'est pas évidente d'après le nom du code,
 * en particulier `SHIPMENT_NO_ELIGIBLE_AGENTS`, qui est un **succès partiel** :
 * l'agent précédent a déjà été retiré et la livraison est désormais sans agent.
 */

const platform = {
    // ─── Livraisons ───────────────────────────────────────────────────────────
    SHIPMENT_STATUS_CONFLICT: 'La livraison a changé pendant que cet écran était ouvert',
    SHIPMENT_NOT_FOUND: 'La plateforme n’a aucune livraison de ce type',
    SHIPMENT_REASSIGN_SAME_AGENT: 'C’est déjà l’agent qui transporte cette livraison.',
    SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT:
        'Cette livraison a dépassé l’enlèvement : la plateforme ne choisira pas d’agent. Choisissez-en un.',
    SHIPMENT_NOT_REASSIGNABLE:
        'Aucun agent n’est rattaché à cette livraison, il n’y a donc personne à remplacer. Annulez-la, ou attendez que l’offre soit acceptée.',
    SHIPMENT_REASSIGNMENT_NOT_ALLOWED: 'Cette livraison ne peut pas être réattribuée dans son état actuel.',
    SHIPMENT_REASSIGNMENT_CONFLICT: 'La livraison a changé pendant que cet écran était ouvert',
    SHIPMENT_NO_ELIGIBLE_AGENTS: 'Aucun remplaçant n’est disponible',
    SHIPMENT_REJECTION_NOT_ALLOWED: 'Cette livraison ne peut pas être annulée dans son état actuel.',
    AGENT_NOT_ELIGIBLE_FOR_ASSIGNMENT:
        'La plateforme refuse d’affecter cette livraison à cet agent pour le moment.',

    // ─── Commandes et remboursements ─────────────────────────────────────────
    ORDER_ALREADY_CANCELLED: 'Cette commande est déjà annulée.',
    ORDER_CANCEL_REQUIRES_REFUND:
        'Cette commande a été payée. Remboursez-la d’abord, puis annulez — l’argent et l’exécution sont deux actes distincts, délibérément.',
    ORDER_NOT_CANCELLABLE: 'La plateforme refuse d’annuler cette commande dans son état actuel.',
    ORDER_DISPUTE_NOT_ACTIVE:
        'Cette commande n’a aucun litige ouvert à trancher. Un autre administrateur l’a peut-être déjà résolu.',
    ORDER_WRONG_TYPE: 'Une commande numérique n’a rien à expédier.',
    ORDER_PAYMENT_REQUIRED:
        'La plateforme n’expédie une commande impayée que s’il s’agit d’un paiement à la livraison.',
    ORDER_DISPUTE_HOLD: 'Cette commande est gelée par un litige de paiement. Réglez d’abord le litige.',
    REFUND_POLICY_OVERRIDE_REQUIRED:
        'Ce remboursement dépasse la politique du vendeur. Passez outre délibérément, ou refusez.',
    REFUND_AMOUNT_EXCEEDS_MAX:
        'C’est plus qu’il ne reste à rembourser. C’est un invariant comptable — aucune dérogation ne le lève.',
    REFUND_ORDER_IS_COD:
        'Il s’agit d’une commande payée à la livraison. L’argent n’est jamais passé par une passerelle : il n’y a rien à inverser ici.',
    REFUND_ORDER_NOT_PAID: 'Cette commande n’a jamais été payée, il n’y a donc rien à rembourser.',
    REFUND_GATEWAY_NOT_SUPPORTED:
        'La passerelle de paiement de cette commande n’a pas d’API de remboursement. C’est un résultat attendu, pas une panne — seul Stripe en propose une aujourd’hui.',
    REFUND_GATEWAY_FAILED:
        'La passerelle de paiement a refusé le remboursement. Rien n’a été prélevé au vendeur ; vérifiez la passerelle avant de réessayer.',
    REFUND_ALREADY_FULLY_REFUNDED: 'Cette commande a déjà été intégralement remboursée.',

    // ─── Paiement à la livraison ─────────────────────────────────────────────
    COD_DEPOSIT_INVALID_AMOUNT: 'La plateforme a refusé le montant',
    COD_DEPOSIT_EXCEEDS_BALANCE: 'C’est plus que l’encaisse détenue par l’agent',
    COD_DEPOSIT_AGENCY_ALREADY_SETTLED: 'La plateforme n’est plus créancière de cette somme',
    COD_DEPOSIT_WRONG_RECIPIENT:
        'Cet argent a été remis à l’agence : seule l’agence peut le confirmer. Aucune autorisation n’y change rien.',
    COD_DEPOSIT_ALREADY_RESOLVED: 'Ce dépôt a déjà été soldé.',
    COD_REMITTANCE_ALREADY_RESOLVED: 'Ce versement a déjà été soldé.',
    COD_DISCREPANCY_ALREADY_RESOLVED: 'Cet écart a déjà été résolu.',
    CONTRACT_SETTLEMENT_EXCEEDS_OUTSTANDING: 'Cette agence n’est pas créancière de cette somme',

    // ─── Agents et contrats ──────────────────────────────────────────────────
    AGENT_NOT_FOUND: 'La plateforme n’a aucun agent de ce type.',
    AGENT_KYC_NOT_VERIFIED: 'L’identité de cet agent n’a pas encore été vérifiée.',
    AGENT_PLATFORM_BANNED: 'Cet agent est banni de toute la plateforme.',
    AGENT_COD_THRESHOLD_BELOW_ALLOCATED:
        'C’est en dessous de ce que les contrats de cet agent immobilisent déjà. Réduisez d’abord les parts contractuelles.',
    AGENT_COD_THRESHOLD_OUT_OF_BOUNDS: 'La plateforme a refusé ce montant, hors bornes.',
    AGENT_MEMBERSHIP_ALREADY_EXISTS: 'Cet agent détient déjà un contrat avec cette agence.',
    AGENT_MEMBERSHIP_NOT_FOUND: 'Ces deux-là ne travaillent pas ensemble',
    CONTRACT_NOT_FOUND: 'La plateforme n’a aucun contrat de ce type.',
    CONTRACT_INVALID_TRANSITION: 'Le contrat ne peut pas passer à cet état depuis celui où il est.',
    CONTRACT_TRANSITION_NOT_PERMITTED:
        'La plateforme n’autorise pas cette partie à effectuer ce changement, quelle que soit l’autorisation que vous détenez ici.',
    CONTRACT_STATUS_REQUEST_ALREADY_PENDING:
        'Une demande est déjà ouverte sur ce contrat. Elle doit être traitée avant qu’une autre puisse être déposée.',
    CONTRACT_HAS_OUTSTANDING_COD:
        'L’agent doit encore de l’argent à cette agence. Cela doit être soldé avant tout transfert.',
    CONTRACT_HAS_UNPAID_EARNINGS:
        'Cette agence doit encore des gains à l’agent. Ils doivent être payés avant tout transfert.',

    // ─── Agences ─────────────────────────────────────────────────────────────
    DELIVERY_AGENCY_NOT_FOUND: 'La plateforme n’a aucune agence de livraison de ce type.',
    DELIVERY_AGENCY_STATUS_CONFLICT: 'Un autre administrateur a modifié cette agence avant vous.',

    // ─── Vendeurs ────────────────────────────────────────────────────────────
    VENDOR_NOT_FOUND: 'La plateforme n’a aucun vendeur de ce type.',
    VENDOR_STATUS_CONFLICT: 'Un autre administrateur a modifié ce vendeur avant vous.',
    VENDOR_KYC_STATUS_CONFLICT: 'Un autre administrateur a tranché avant vous.',
    VENDOR_PRODUCT_NOT_SUSPENDABLE: 'Il n’est plus en vente.',
    VENDOR_PRODUCT_NOT_OVERSIGHT_SUSPENDED:
        'Ce produit n’a pas été retiré par un administrateur : le rétablir ici reviendrait à annuler la décision du vendeur.',
    VENDOR_PRODUCT_UNSUSPEND_BLOCKED: 'Quelque chose empêche encore la remise en vente de ce produit.',
    CATALOG_PRODUCT_NOT_FOUND: 'La plateforme n’a aucun produit de ce type.',

    // ─── Utilisateurs ────────────────────────────────────────────────────────
    USER_STATUS_CONFLICT: 'Un autre administrateur a modifié ce compte avant vous.',
    USER_CONTACT_REQUIRED: 'Un compte doit conserver au moins un identifiant de connexion',
    AUTH_EMAIL_TAKEN: 'Cet e-mail appartient déjà à un autre compte',
    AUTH_PHONE_TAKEN: 'Ce numéro de téléphone appartient déjà à un autre compte',

    // ─── Récupération d’accès ────────────────────────────────────────────────
    USER_CHANNEL_UNAVAILABLE:
        'Cette personne n’a aucune adresse sur ce canal. Telegram ne fonctionne qu’une fois qu’elle a elle-même connecté le bot.',
    USER_CREDENTIAL_LINK_THROTTLED: 'Trop de liens de récupération ont été envoyés récemment.',
    USER_LOGIN_LINK_ROLE_UNSUPPORTED:
        'Les liens de connexion sont réservés aux clients. Les vendeurs, agences et livreurs accèdent à de l’argent et aux données d’autrui : envoyez plutôt un lien de réinitialisation.',
    MESSAGING_CONNECTION_NOT_FOUND:
        'Ce compte n’a pas connecté Telegram : il n’y a aucune conversation vers laquelle envoyer.',
    MESSAGING_DELIVERY_FAILED:
        'Le canal a accepté la demande sans la délivrer. Rien n’a été envoyé — essayez un autre canal.',
    AUTH_ACCOUNT_SUSPENDED:
        'Ce compte est suspendu : il n’y a rien vers quoi le faire revenir.',

    // ─── Facturation ─────────────────────────────────────────────────────────
    BILLING_PLAN_CODE_EXISTS: 'Ce code est déjà pris par une autre formule',
    BILLING_PLAN_NOT_FOUND:
        'La plateforme ne trouve pas cette formule. Elle a très probablement été archivée — une formule archivée ne peut plus être attribuée, mais ses abonnés actuels y restent.',
    BILLING_PLAN_INACTIVE: 'Cette formule n’est pas commercialisable.',
    BILLING_PLAN_ROLE_MISMATCH: 'Cette formule s’adresse à un autre type de titulaire.',
    BILLING_PENDING_PLAN_EXISTS:
        'Ce titulaire a déjà une période en attente de démarrage, car la précédente n’est pas encore échue. Attendez son activation, ou annulez-la sur la plateforme.',

    // ─── Finances ────────────────────────────────────────────────────────────
    EARNINGS_PAYOUT_REQUEST_NOT_PENDING: 'Ce versement n’est plus en attente.',

    // ─── Fichiers ────────────────────────────────────────────────────────────
    UPLOAD_POLICY_VIOLATION: 'La plateforme a refusé l’un de ces fichiers.',
};

export default platform;
