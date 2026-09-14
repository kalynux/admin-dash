/**
 * Codes d'erreur du backend → texte français.
 *
 * Structurellement un `DeepPartial` du catalogue anglais : une clé absente
 * retombe sur l'anglais plutôt que d'afficher son chemin. `platform` et
 * `contexts` suivent les mêmes clés que l'anglais — ce sont des codes du
 * backend, jamais traduits.
 *
 * Registre : vouvoiement, ton opérationnel. Le lecteur est un administrateur
 * interne, pas un client.
 */

import platform from './error-platform';

const codes = {
    // ─── Générique ────────────────────────────────────────────────────────────
    INTERNAL_SERVER_ERROR: 'Une erreur est survenue',
    NOT_FOUND: 'Introuvable',
    VALIDATION_ERROR: 'Vérifiez les champs signalés',
    RATE_LIMIT_EXCEEDED: 'Trop de requêtes',

    // ─── Requête mal formée, avant tout schéma ───────────────────────────────
    REQUEST_BODY_INVALID: 'Cette requête n’a pas pu être lue',
    REQUEST_BODY_TOO_LARGE: 'Cette requête est trop volumineuse',
    REQUEST_MEDIA_TYPE_UNSUPPORTED: 'Ce type de contenu n’est pas accepté',

    // ─── Authentification ────────────────────────────────────────────────────
    ADMIN_AUTH_INVALID_CREDENTIALS: 'Ces identifiants n’ont pas été reconnus',
    ADMIN_AUTH_ACCOUNT_LOCKED: 'Ce compte est temporairement verrouillé',
    ADMIN_AUTH_ACCOUNT_SUSPENDED: 'Ce compte est suspendu',
    ADMIN_AUTH_MISSING_TOKEN: 'Vous n’êtes pas connecté',
    ADMIN_AUTH_TOKEN_INVALID: 'Votre connexion n’a pas pu être vérifiée',
    ADMIN_AUTH_TOKEN_EXPIRED: 'Votre connexion a expiré',
    ADMIN_AUTH_SESSION_REVOKED: 'Cette session a été fermée',
    ADMIN_AUTH_SESSION_EXPIRED: 'Cette session a expiré',
    ADMIN_AUTH_REFRESH_REUSED: 'Cette session a été fermée par sécurité',
    ADMIN_AUTH_MFA_REQUIRED: 'Terminez la configuration de la double authentification',
    ADMIN_AUTH_MFA_INVALID: 'Ce code n’a pas été accepté',
    ADMIN_AUTH_MFA_ALREADY_ENROLLED: 'Un secret a déjà été délivré',
    ADMIN_AUTH_MFA_NOT_ENROLLED: 'Il n’y a rien à confirmer pour l’instant',
    ADMIN_AUTH_CSRF_INVALID: 'Cette requête n’a pas pu vous être attribuée',
    ADMIN_AUTH_PASSWORD_WEAK: 'Ce mot de passe ne respecte pas la politique',

    // ─── Autorisation ────────────────────────────────────────────────────────
    AUTHZ_PERMISSION_DENIED: 'Vous n’avez pas l’autorisation de faire cela',
    AUTHZ_TIER_INSUFFICIENT: 'Votre niveau ne permet pas d’accéder à ceci',
    AUTHZ_SELF_ACTION_FORBIDDEN: 'Vous ne pouvez pas faire cela sur votre propre compte',
    AUTHZ_TARGET_TIER_PROTECTED: 'Cet administrateur est à votre niveau ou au-dessus',
    AUTHZ_TIER_ESCALATION_FORBIDDEN: 'Vous ne pouvez pas attribuer un niveau égal ou supérieur au vôtre',
    AUTHZ_APPROVAL_REQUIRED: 'Aucune procédure d’approbation n’existe ici',
    AUTHZ_APPROVAL_NOT_FOUND: 'Demande d’approbation introuvable',
    AUTHZ_APPROVAL_SELF_APPROVAL: 'Vous ne pouvez pas approuver votre propre demande',
    AUTHZ_APPROVAL_EXPIRED: 'Cette demande a expiré',
    AUTHZ_APPROVAL_ALREADY_RESOLVED: 'Cette demande a déjà été tranchée',

    // ─── Comptes administrateurs ─────────────────────────────────────────────
    ADMIN_ACCOUNT_NOT_FOUND: 'Administrateur introuvable',
    ADMIN_ACCOUNT_ALREADY_EXISTS: 'Un administrateur utilise déjà cette adresse',
    ADMIN_SESSION_NOT_FOUND: 'Session introuvable',

    // ─── Activation des administrateurs (ADR-023) ────────────────────────────
    ADMIN_ACTIVATION_REQUIRED: 'Votre compte attend son activation',
    ADMIN_ACTIVATION_INCOMPLETE: 'Son dossier salarié n’est pas encore complet',
    ADMIN_ACTIVATION_SUSPENDED: 'Ce compte est suspendu — rétablissez-le plutôt',
    ADMIN_ACTIVATION_SELF: 'Un autre développeur doit activer votre compte',
    ADMIN_ACTIVATION_CONFLICT: 'Quelqu’un a modifié ce compte pendant votre consultation',

    // ─── Dossiers salariés (ADR-023) ─────────────────────────────────────────
    EMPLOYEE_SLOT_FULL: 'Cet emplacement est plein — retirez un fichier avant d’en ajouter un autre',
    EMPLOYEE_DOCUMENT_NOT_FOUND: 'Cet emplacement ne contient pas ce fichier',

    // ─── Journal d’audit ─────────────────────────────────────────────────────
    AUDIT_ENTRY_NOT_FOUND: 'Entrée d’audit introuvable',
    AUDIT_EXPORT_NOT_FOUND: 'Export introuvable',
    AUDIT_EXPORT_TOO_LARGE: 'Cette période couvre trop de lignes',
    AUDIT_EXPORT_INCOMPLETE: 'Cet export ne s’est pas terminé',
    AUDIT_EXPORT_FILE_MISSING: 'Ce fichier d’export n’est plus disponible',

    // ─── Système et outils de développement ──────────────────────────────────
    DEV_TOOLS_DISABLED: 'Les outils de développement sont désactivés',
    SYSTEM_ERROR_QUERY_TOO_BROAD: 'Affinez cette recherche',

    // ─── Finances et comptes ─────────────────────────────────────────────────
    PAYOUT_DESTINATION_ABSENT: 'Ce versement n’a aucune destination enregistrée',
    PAYOUT_NOT_PENDING: 'Ce versement n’est plus en attente',
    ACCOUNT_OWNER_NOT_FOUND: 'Titulaire de compte introuvable',

    // ─── Réseau de livraison ─────────────────────────────────────────────────
    CONTRACT_NOT_FOUND: 'Aucun contrat ne correspond à cet identifiant',

    // ─── Suivi, la porte de données geo-tracker ──────────────────────────────
    TRACKING_DOOR_UNCONFIGURED: 'Le suivi en direct n’est pas activé sur ce déploiement',
    TRACKING_DOOR_REFUSED: 'Le service de suivi a refusé cette lecture',
    TRACKING_DOOR_UNAVAILABLE: 'Le service de suivi est injoignable',

    // Porte de signalement de l’automatisation. Ces messages s’adressent à un
    // opérateur qui lit la réponse d’un nœud n8n, jamais à un utilisateur du
    // tableau de bord : la route qui les émet ne lui est pas accessible.
    AUTOMATION_REPORT_TOKEN_INVALID: 'Le jeton de signalement d’automatisation est absent ou erroné',
    AUTOMATION_REPORT_MALFORMED: 'Ce rapport d’incident n’indique ni workflow ni type',
    AUTOMATION_DOOR_UNCONFIGURED: 'Ce déploiement n’accepte aucun rapport d’incident d’automatisation',

    // ─── Assistance ──────────────────────────────────────────────────────────
    TICKET_NOT_FOUND: 'Ticket introuvable',
    TICKET_ALREADY_ASSIGNED: 'Quelqu’un d’autre a déjà pris ce ticket',

    // ─── Contenu ─────────────────────────────────────────────────────────────
    BLOG_ARTICLE_NOT_FOUND: 'Aucun article ne correspond à cette clé',
    BLOG_ARTICLE_KEY_TAKEN: 'Un autre article utilise déjà cette clé',
    BLOG_ARTICLE_NOT_PUBLISHABLE: 'Cet article n’est pas prêt à être publié',
    BLOG_ARTICLE_ALREADY_PUBLISHED: 'Cet article est déjà publié',
    BLOG_ARTICLE_DELETE_NOT_ALLOWED: 'Un article publié ne peut pas être supprimé',
    BLOG_SLUG_TAKEN: 'Une autre adresse web identique existe déjà',
    BLOG_SLUG_RESERVED: 'Cette adresse web est réservée',
    BLOG_AUTHOR_NOT_FOUND: 'Aucun auteur ne correspond à cette clé',
    BLOG_AUTHOR_KEY_TAKEN: 'Un autre auteur utilise déjà cette clé',
    BLOG_AUTHOR_IN_USE: 'Des articles créditent encore cet auteur',

    // ─── Fichiers ────────────────────────────────────────────────────────────
    FILE_NOT_FOUND: 'Ce fichier n’est plus stocké',
    FILE_DELETE_NOT_CONFIRMED: 'Saisissez la confirmation exacte pour supprimer ce fichier',
    FILE_UPLOAD_NOT_MULTIPART: 'Cet envoi n’a pas été transmis comme un fichier',
    // Pas de taille ici : le plafond est une configuration de déploiement et la
    // réponse le porte dans `details.maxBytes`.
    FILE_UPLOAD_TOO_LARGE: 'Ce fichier est trop volumineux pour être envoyé',
    FILE_CONTENT_NOT_SUPPORTED: 'Cette plateforme ne peut pas afficher les fichiers stockés',

    // ─── Notifications ───────────────────────────────────────────────────────
    NOTIFICATION_NOT_FOUND: 'Notification introuvable',

    // ─── Infrastructure ──────────────────────────────────────────────────────
    SERVICE_DEPENDENCY_UNAVAILABLE: 'Un service dont nous dépendons n’a pas répondu',
    PLATFORM_OPERATION_REJECTED: 'La plateforme a refusé cette opération',
    DATABASE_UNIQUE_CONSTRAINT_VIOLATION: 'Cette valeur est déjà utilisée',
};

const codeHints = {
    INTERNAL_SERVER_ERROR:
        'Rien de votre côté n’en est la cause. Citez la référence lorsque vous le signalez.',
    VALIDATION_ERROR: 'Un ou plusieurs champs n’ont pas été acceptés.',
    RATE_LIMIT_EXCEEDED: 'Attendez une minute avant de réessayer.',

    REQUEST_BODY_TOO_LARGE: 'La limite est de 1 Mo.',
    REQUEST_MEDIA_TYPE_UNSUPPORTED: 'Envoyez du JSON.',

    ADMIN_AUTH_INVALID_CREDENTIALS: 'Vérifiez l’adresse e-mail et le mot de passe, puis réessayez.',
    ADMIN_AUTH_ACCOUNT_LOCKED:
        'Trop de tentatives échouées. Attendez la levée du verrou avant de réessayer — une nouvelle tentative maintenant le prolongerait.',
    ADMIN_AUTH_ACCOUNT_SUSPENDED:
        'Toutes les sessions ont été fermées. Un autre administrateur doit réactiver le compte avant toute connexion.',
    ADMIN_AUTH_MISSING_TOKEN: 'Connectez-vous pour continuer.',
    ADMIN_AUTH_TOKEN_INVALID: 'Reconnectez-vous.',
    ADMIN_AUTH_SESSION_REVOKED:
        'Elle a été fermée, révoquée, ou laissée inactive trop longtemps. Reconnectez-vous.',
    ADMIN_AUTH_SESSION_EXPIRED: 'Les sessions se terminent après une durée fixe. Reconnectez-vous.',
    ADMIN_AUTH_REFRESH_REUSED:
        'Un jeton de connexion périmé a été présenté : toute la session a donc été détruite. Reconnectez-vous.',
    ADMIN_AUTH_MFA_REQUIRED:
        'Cette session n’atteint que les écrans de configuration tant qu’aucune application d’authentification n’est enregistrée.',
    ADMIN_AUTH_MFA_INVALID:
        'Consultez votre application d’authentification et saisissez les six chiffres actuels. Les codes expirent vite.',
    ADMIN_AUTH_MFA_ALREADY_ENROLLED:
        'Il ne peut pas être affiché deux fois. Saisissez un code de l’application que vous avez configurée.',
    ADMIN_AUTH_MFA_NOT_ENROLLED: 'Recommencez la configuration pour obtenir un nouveau secret.',
    ADMIN_AUTH_CSRF_INVALID: 'Rechargez la page et réessayez.',

    AUTHZ_SELF_ACTION_FORBIDDEN: 'Un autre administrateur doit le faire.',
    AUTHZ_TARGET_TIER_PROTECTED:
        'Vous ne pouvez agir que sur des administrateurs de niveau inférieur au vôtre.',
    AUTHZ_APPROVAL_REQUIRED:
        'Créez d’abord le compte à un niveau inférieur, puis demandez une promotion que la file d’approbation examinera.',
    AUTHZ_APPROVAL_SELF_APPROVAL:
        'Un second administrateur doit la trancher. C’est tout l’objet du double contrôle.',
    AUTHZ_APPROVAL_EXPIRED: 'Les demandes expirent après 24 heures. Soumettez-la à nouveau.',
    AUTHZ_APPROVAL_ALREADY_RESOLVED: 'Rechargez pour voir la décision.',

    AUDIT_EXPORT_TOO_LARGE:
        'Réduisez la période, ou lancez l’export depuis la ligne de commande.',
    AUDIT_EXPORT_INCOMPLETE: 'Demandez-le à nouveau.',
    AUDIT_EXPORT_FILE_MISSING:
        'L’enregistrement existe toujours ; le fichier a été nettoyé. Demandez-le à nouveau.',

    DEV_TOOLS_DISABLED:
        'Vous détenez l’autorisation — c’est le service qui refuse actuellement. Activez le drapeau pour continuer.',
    SYSTEM_ERROR_QUERY_TOO_BROAD: 'Ajoutez une référence, ou un code accompagné d’une date de début.',

    PAYOUT_DESTINATION_ABSENT:
        'Il s’agit d’un ancien enregistrement sans destination. Renseignez-vous auprès du bénéficiaire.',
    PAYOUT_NOT_PENDING: 'Rechargez pour voir son état actuel.',

    CONTRACT_NOT_FOUND: 'Vérifiez l’identifiant, ou ouvrez le contrat depuis le livreur ou l’agence.',
    FILE_NOT_FOUND:
        'L’enregistrement qui le référençait existe toujours ; le fichier lui-même a été supprimé.',
    FILE_UPLOAD_NOT_MULTIPART:
        'Rien n’a été envoyé. Sélectionnez à nouveau le fichier, et citez la référence si cela persiste.',
    FILE_UPLOAD_TOO_LARGE:
        'Rien n’a été envoyé. Transmettez une version plus légère, ou répartissez-la sur plusieurs fichiers.',
    FILE_CONTENT_NOT_SUPPORTED:
        'Le mode de stockage de ce déploiement empêche d’ouvrir le contenu des fichiers ici. Rien n’est en panne — les informations ci-dessus restent exactes.',

    SERVICE_DEPENDENCY_UNAVAILABLE:
        'Ce n’est pas de votre fait et cela ne se corrige pas d’ici. Réessayez sous peu, et citez la référence si cela persiste.',
    DATABASE_UNIQUE_CONSTRAINT_VIOLATION: 'Choisissez-en une autre.',
};

const category = {
    authentication: 'Déconnecté',
    authorization: 'Non autorisé',
    validation: 'Requête invalide',
    not_found: 'Introuvable',
    conflict: 'État modifié',
    business_rule: 'Refusé',
    rate_limit: 'Trop de requêtes',
    external_service: 'Service indisponible',
    internal: 'Une erreur est survenue',
};

const categoryHint = {
    authentication:
        'L’appelant n’était pas connecté, ou sa session avait pris fin. Demandez-lui de se reconnecter.',
    authorization:
        'L’appelant est connecté mais a atteint quelque chose qui ne lui appartient pas. Vérifiez quel compte et quel rôle il utilise.',
    validation:
        'La requête était mal formée ou a échoué à une règle de champ. Généralement un problème côté client — demandez ce qui a été saisi.',
    not_found:
        'L’enregistrement n’existe pas, ou n’appartient pas à cet appelant. Confirmez la référence utilisée.',
    conflict:
        'Quelque chose a changé entre-temps — souvent une autre personne agissant au même moment. Demandez de recharger et de réessayer.',
    business_rule:
        'La plateforme a refusé volontairement. Le message explique quelle règle ; ce n’est pas une panne.',
    rate_limit:
        'Trop de requêtes sur une courte période. Cela se résorbe tout seul — demandez d’attendre une minute avant de réessayer.',
    external_service:
        'Un service dont nous dépendons n’a pas répondu. Ce n’est pas de leur fait et ils ne peuvent rien y faire — remontez avec la référence.',
    internal:
        'Une panne de notre côté. L’appelant ne peut rien y faire. Remontez avec la référence.',
};

const status = {
    400: 'Cette requête a été rejetée',
    401: 'Vous n’êtes pas connecté',
    403: 'Vous n’avez pas l’autorisation de faire cela',
    404: 'Introuvable',
    409: 'Quelque chose a changé entre-temps',
    413: 'Cette requête est trop volumineuse',
    415: 'Ce type de contenu n’est pas accepté',
    422: 'Cela a été refusé',
    423: 'C’est verrouillé',
    429: 'Trop de requêtes',
    500: 'Une erreur est survenue',
    502: 'Un service dont nous dépendons n’a pas répondu',
    503: 'Un service dont nous dépendons est indisponible',
    504: 'Un service dont nous dépendons a expiré',
};

const detail = {
    platformRefused: 'Refus de la plateforme : {{platformCode}}',
    dependencyUnavailable: 'Aucune réponse d’un service dont nous dépendons.',
    retryAfter: 'Réessayez dans {{seconds}} s.',
    requiresAny: 'Exige l’une de : {{permissions}}',
    requiresAll: 'Exige toutes de : {{permissions}}',
    reference: 'Référence : {{requestId}}',
    waitSeconds: {
        __plural: {
            one: 'Réessayez dans {{count}} seconde.',
            other: 'Réessayez dans {{count}} secondes.',
        },
    },
    waitMinutes: {
        __plural: {
            one: 'Réessayez dans environ {{count}} minute.',
            other: 'Réessayez dans environ {{count}} minutes.',
        },
    },
};

const state = {
    loadFailed: 'Impossible de charger ceci',
    denied: 'Non disponible pour vous',
    retry: 'Réessayer',
    renderFailed: 'Cet écran a cessé de fonctionner',
    empty: 'Rien pour l’instant',
    lookUp: 'Rechercher ceci',
    queuedHeading: 'Rien n’a encore changé.',
    queuedFallback: 'Soumis à l’approbation d’un second administrateur.',
    languageNotSaved:
        'La langue a bien changé, mais n’a pas pu être enregistrée dans votre profil',
};

const fields = {
    email: 'Saisissez une adresse e-mail valide.',
    password: 'Vérifiez ce mot de passe.',
    tier: 'Choisissez un niveau.',
    reason: 'Indiquez un motif.',
    amount: 'Saisissez un montant valide.',
    code: 'Saisissez le code à six chiffres.',
};

const contexts = {
    auth: {
        RATE_LIMIT_EXCEEDED: 'Trop de tentatives',
    },
    orders: {
        cancelBlockedByFulfilment:
            'L’exécution est à « {{status}} », ce qui dépasse le stade où une commande peut être annulée.',
        cancelBlockedByPayment:
            'Le paiement est à « {{status}} », ce sur quoi la plateforme refuse d’annuler.',
    },
    billing: {
        planInactive:
            '{{plan}} n’est pas commercialisable. Activez la formule avant de l’attribuer.',
        planRoleMismatch:
            '{{plan}} est une formule « {{role}} » et ne peut pas être attribuée à un titulaire « {{ownerType}} ».',
    },
    billingPlanForm: {
        BILLING_PLAN_NOT_FOUND:
            'La plateforme ne trouve pas cette formule. Elle a très probablement été archivée — une formule archivée ne peut plus être modifiée, mais ses abonnés y restent.',
    },
};

export default {
    unknown: 'Une erreur est survenue.',
    network: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
    fieldInvalid: 'Vérifiez ce champ.',

    codes,
    codeHints,
    platform,
    category,
    categoryHint,
    status,
    detail,
    state,
    fields,
    contexts,
};
