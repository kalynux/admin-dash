import logo from '@/assets/brand/wimall-logo.png';
import { cn } from '@/lib/utils';

export function AppLogo({ className, alt = 'WiMall' }: { className?: string; alt?: string }) {
    return <img src={logo} alt={alt} className={cn('object-contain', className)} />;
}
