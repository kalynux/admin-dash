import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';

export function NotFound() {
    return (
        <PageContainer title="Page not found">
            <EmptyState
                icon={SearchX}
                title="Page not found"
                description="That route does not exist in this dashboard."
                action={
                    <Button asChild variant="outline" size="sm">
                        <Link to="/dashboard">Back to the dashboard</Link>
                    </Button>
                }
            />
        </PageContainer>
    );
}
