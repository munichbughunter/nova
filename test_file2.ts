// Another test file for CLI validation
interface User {
    id: number;
    name: string;
    email: string;
}

function validateUser(user: User): boolean {
    return user.id > 0 && user.name.length > 0 && user.email.includes('@');
}

export { User, validateUser };