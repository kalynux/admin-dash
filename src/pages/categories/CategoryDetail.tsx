import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitMerge, Pencil, ScrollText, Trash2 } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CategoryDialogs, type CategoryAction } from '@/components/categories/CategoryDialogs';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { ActionWithheld } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { getCategory } from '@/services/categories.service';
import { useAdmin, useCan } from '@/store';
import { categorySourceLabel } from '@/types/categories.types';

/**
 * One shared category — `GET /categories/:categoryId` · `catalog.categories.read`.
 *
 * The list row's shape, and the one place `aliasKeys` is shown: under **Also
 * matches**, as matching keys rather than names, because that is what they
 * are — the normalised spellings the vendor-side duplicate check will already
 * fold into this category (its old names, and everything merged into it).
 *
 * A merged-away or deleted category answers `404`. After a merge from here the
 * screen follows the products to the survivor; after a delete it returns to the
 * list.
 */
export function CategoryDetail() {
    const { categoryId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const navigate = useNavigate();
    const timeZone = resolveTimeZone(admin.timezone);
    const [action, setAction] = useState<CategoryAction | null>(null);

    const category = useAsyncData(`/categories/${categoryId}`, (signal) =>
        getCategory(categoryId, { signal }),
    );

    if (category.isLoading) {
        return (
            <PageContainer title="Category">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!category.data) {
        return (
            <PageContainer title="Category">
                <div className="space-y-4">
                    <ErrorState
                        error={category.error}
                        onRetry={category.reload}
                        deniedTitle="No such category"
                    />
                    <p className="text-muted-foreground text-sm">
                        A category that was merged into another, or deleted, is no longer here.
                    </p>
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = category.data;

    return (
        <PageContainer
            title={record.name}
            description={record.slug}
            actions={
                <Can permission="catalog.categories.manage">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setAction({ kind: 'rename', category: record })}
                        >
                            <Pencil className="size-4" />
                            Rename
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setAction({ kind: 'merge', category: record })}
                        >
                            <GitMerge className="size-4" />
                            Merge
                        </Button>
                        {record.productCount === 0 ? (
                            <Button
                                variant="outline"
                                onClick={() => setAction({ kind: 'delete', category: record })}
                            >
                                <Trash2 className="size-4" />
                                Delete
                            </Button>
                        ) : (
                            <ActionWithheld
                                label="Delete"
                                reason="Products use it. Only an unused category can be deleted — merge this one into another to retire it."
                            />
                        )}
                    </div>
                </Can>
            }
        >
            <div className="space-y-4">
                <BackLink />

                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Category</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition label="Name">{record.name}</Definition>
                                <Definition label="Slug">
                                    <CopyableValue variant="plain" mono value={record.slug} label="slug" />
                                </Definition>
                                <Definition label="Id">
                                    <CopyableId value={record.id} label="category id" />
                                </Definition>
                                <Definition
                                    label="Products"
                                    hint={
                                        <InfoHint label="About the product count">
                                            Every product that holds this category, drafts
                                            included. It is what a merge moves, and why a delete is
                                            refused.
                                        </InfoHint>
                                    }
                                >
                                    {formatCount(record.productCount)}
                                </Definition>
                                <Definition label="On sale">
                                    {formatCount(record.activeProductCount)}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Origin</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition label="Created by">
                                    {categorySourceLabel(record.createdSource)}
                                </Definition>
                                <Definition
                                    label="Vendor"
                                    hint={
                                        <InfoHint label="About the creating vendor">
                                            Recorded for the audit trail only. A category belongs
                                            to no vendor — every shop can use it.
                                        </InfoHint>
                                    }
                                >
                                    {record.createdByVendorId ? (
                                        <CopyableId
                                            value={record.createdByVendorId}
                                            label="vendor id"
                                            to={
                                                can('vendors.read')
                                                    ? `/dashboard/vendors/${record.createdByVendorId}`
                                                    : undefined
                                            }
                                        />
                                    ) : (
                                        <NotSet>None</NotSet>
                                    )}
                                </Definition>
                                <Definition label="Created">
                                    {formatInstantInZone(record.createdAt, timeZone) ?? <NotSet />}
                                </Definition>
                                <Definition label="Updated">
                                    {formatInstantInZone(record.updatedAt, timeZone) ?? <NotSet />}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Also matches</CardTitle>
                        <CardDescription>
                            Spellings that already lead here: this category&apos;s previous names
                            and every category merged into it. A vendor typing one of them lands on{' '}
                            {record.name}. These are matching keys, not names.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {record.aliasKeys.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                None yet — it has never been renamed, and nothing has been merged
                                into it.
                            </p>
                        ) : (
                            <ul className="flex flex-wrap gap-2" aria-label="Spellings that match">
                                {record.aliasKeys.map((key) => (
                                    <li key={key}>
                                        <Badge variant="secondary" className="font-mono">
                                            {key}
                                        </Badge>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Can permission="audit.read">
                    <Link
                        to={`/dashboard/audit?targetType=category&targetId=${encodeURIComponent(record.id)}`}
                        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
                    >
                        <ScrollText className="size-4" />
                        Renames, merges and deletes in the audit trail
                    </Link>
                </Can>
            </div>

            <CategoryDialogs
                action={action}
                onActionChange={setAction}
                onRenamed={category.reload}
                // The products went to the survivor — follow them there.
                onMerged={(result) => navigate(`/dashboard/categories/${result.target.id}`)}
                onDeleted={() => navigate('/dashboard/categories')}
                onStale={category.reload}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/categories"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to categories
        </Link>
    );
}
