// Debug test for isReviewableFile
const pattern = /package-lock\.json$/i;
console.log('Testing package-lock.json:', pattern.test('package-lock.json'));
console.log('Testing yarn.lock:', /yarn\.lock$/i.test('yarn.lock'));
console.log('Testing .DS_Store:', /\.(DS_Store|thumbs\.db)$/i.test('.DS_Store'));

// Test the actual logic
function testIsReviewable(filePath: string): boolean {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    
    const reviewableExtensions = [
        'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt',
        'scala', 'clj', 'hs', 'elm', 'dart', 'vue', 'svelte',
        'html', 'htm', 'css', 'scss', 'sass', 'less',
        'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf',
        'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
        'md', 'rst', 'txt',
        'dockerfile', 'makefile', 'cmake', 'gradle', 'maven', 'sbt',
    ];

    if (reviewableExtensions.includes(extension)) {
        console.log(`${filePath} has reviewable extension: ${extension}`);
        return true;
    }

    const excludePatterns = [
        /\.(exe|dll|so|dylib|a|lib|bin|obj|o)$/i,
        /\.(jpg|jpeg|png|gif|bmp|svg|ico|webp)$/i,
        /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i,
        /\.(mp3|wav|flac|aac|ogg|wma)$/i,
        /\.(zip|tar|gz|rar|7z|bz2|xz)$/i,
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
        /\.(lock|log|tmp|temp|cache)$/i,
        /package-lock\.json$/i,
        /yarn\.lock$/i,
        /composer\.lock$/i,
        /\.(DS_Store|thumbs\.db)$/i,
        /\.(idea|vscode|vs)$/i,
    ];

    if (excludePatterns.some(pattern => pattern.test(filePath))) {
        console.log(`${filePath} matches exclude pattern`);
        return false;
    }

    console.log(`${filePath} does not match any patterns, returning false`);
    return false;
}

console.log('package-lock.json:', testIsReviewable('package-lock.json'));
console.log('yarn.lock:', testIsReviewable('yarn.lock'));
console.log('.DS_Store:', testIsReviewable('.DS_Store'));