/**
 * Password Policy Utility
 * Enforces password strength requirements
 */

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with isValid flag and errors array
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      errors: ["Password is required"]
    };
  }

  const errors = [];

  // Minimum length
  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  // Maximum length (prevent DoS)
  if (password.length > 128) {
    errors.push("Password must be less than 128 characters");
  }

  // Uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter (A-Z)");
  }

  // Lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter (a-z)");
  }

  // Number
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number (0-9)");
  }

  // Special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*...)");
  }

  // Common passwords check
  const commonPasswords = [
    'password', '123456', 'admin', 'qwerty', 'letmein', 
    'welcome', 'monkey', '1234567890', 'abc123', 'password123',
    'admin123', 'root', 'toor', 'pass', 'test', 'guest'
  ];
  
  const passwordLower = password.toLowerCase();
  const containsCommon = commonPasswords.some(common => 
    passwordLower.includes(common) || passwordLower === common
  );
  
  if (containsCommon) {
    errors.push("Password cannot be a common password or contain common words");
  }

  // Check for repeated characters (e.g., "aaaaaa")
  if (/(.)\1{4,}/.test(password)) {
    errors.push("Password cannot contain more than 4 repeated characters");
  }

  // Check for sequential characters (e.g., "12345", "abcde")
  const sequences = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const passwordLowerForSeq = passwordLower.replace(/[^a-z0-9]/g, '');
  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - 5; i++) {
      const subSeq = seq.substring(i, i + 5);
      if (passwordLowerForSeq.includes(subSeq) || passwordLowerForSeq.includes(subSeq.split('').reverse().join(''))) {
        errors.push("Password cannot contain sequential characters");
        break;
      }
    }
    if (errors.some(e => e.includes("sequential"))) break;
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    strength: calculatePasswordStrength(password)
  };
}

/**
 * Calculate password strength score (0-100)
 * @param {string} password - Password to evaluate
 * @returns {number} Strength score (0-100)
 */
function calculatePasswordStrength(password) {
  let score = 0;

  // Length score (max 25 points)
  if (password.length >= 8) score += 10;
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 5;

  // Character variety (max 40 points)
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 10;
  if (/[^a-zA-Z0-9]/.test(password)) score += 10;

  // Complexity (max 35 points)
  const uniqueChars = new Set(password).size;
  score += Math.min(uniqueChars * 2, 20);

  if (!/(.)\1{3,}/.test(password)) score += 10; // No repeated chars
  if (password.length >= 12 && uniqueChars >= 8) score += 5; // Long and diverse

  return Math.min(score, 100);
}

/**
 * Get password policy description
 * @returns {Object} Password policy requirements
 */
export function getPasswordPolicyDescription() {
  return {
    minLength: 8,
    maxLength: 128,
    requirements: [
      "At least 8 characters long",
      "At least one uppercase letter (A-Z)",
      "At least one lowercase letter (a-z)",
      "At least one number (0-9)",
      "At least one special character (!@#$%^&*...)",
      "Cannot be a common password",
      "Cannot contain more than 4 repeated characters",
      "Cannot contain sequential characters (e.g., 12345, abcde)"
    ],
    examples: {
      weak: ["password", "12345678", "admin123"],
      strong: ["MyP@ssw0rd!", "Tr0ub4dor&3", "C0rrectH0rseB@ttery"]
    }
  };
}

/**
 * Check if password meets minimum requirements (for backward compatibility)
 * @param {string} password - Password to check
 * @returns {boolean} True if password meets minimum requirements
 */
export function meetsMinimumRequirements(password) {
  if (!password || password.length < 6) {
    return false;
  }
  return true;
}


