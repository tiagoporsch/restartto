# Restart To

![screenshot](https://github.com/user-attachments/assets/38df95e1-cd27-48f4-b103-826d4e089cda)

## Dependencies

- efibootmgr

## Passwordless

If you don't want to type your password every time you want to reboot somewhere else, create a rule in the directory `/etc/polkit-1/rules.d`, such as `50-efibootmgr.rules`, and write the following:

```js
polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.policykit.exec" &&
        subject.isInGroup("wheel") &&
        action.lookup("program") == "/usr/bin/efibootmgr") {
        return polkit.Result.YES;
    }
});
```

This rule allows every user in the group `wheel` to run `efibootmgr` using `pkexec` without typing their password. Note that depending on your distribution, the default sudo group is not `wheel`, but `sudo` or something else, so you'll need to change the rule accordingly.
