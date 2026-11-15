document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.ripple').forEach(btn => {
        btn.addEventListener('click', function (e) {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const ripple = document.createElement('span');
            ripple.className = 'ripple-effect';
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            ripple.style.width = ripple.style.height = `${Math.max(rect.width, rect.height)}px`;

            this.appendChild(ripple);

            ripple.addEventListener('animationend', () => {
                ripple.remove();
            });
        });
    });

    const successMsg = document.querySelector('.success-message');
    if (successMsg) {
        setTimeout(() => {
            successMsg.style.transition = 'opacity 0.5s';
            successMsg.style.opacity = '0';
            setTimeout(() => {
                if (successMsg.parentNode) {
                    successMsg.parentNode.removeChild(successMsg);
                }
            }, 500);
        }, 7000);
    }

    const form = document.querySelector('.eval-form');
    if (form) {
        form.addEventListener('submit', function (e) {
            const phone = document.getElementById('phone');
            if (phone && !/^\+?[0-9\s\-()]{7,}$/.test(phone.value.trim())) {
                e.preventDefault();
                let err = phone.parentElement.querySelector('.error');
                if (!err) {
                    err = document.createElement('div');
                    err.className = 'error';
                    phone.parentElement.appendChild(err);
                }
                err.textContent = 'Введите корректный номер телефона';
                phone.focus();
            }
        });
    }
});